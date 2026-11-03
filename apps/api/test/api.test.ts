import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DailyScheduler } from "../src/daily/scheduler.js";
import { DailyService } from "../src/daily/service.js";
import { openDatabase } from "../src/db/index.js";
import { MIGRATIONS } from "../src/db/migrations.js";
import { insertQuoteRaw } from "../src/db/quotes.js";
import { planEmbeddingBatches } from "../src/embeddings/provider.js";
import { TelegramService } from "../src/telegram/service.js";

const API_KEY = "test-api-key-0123456789";
const ORIGIN = "http://localhost:5173";
const TELEGRAM_TOKEN = "123456:test-telegram-token";

let directory: string;
let app: FastifyInstance;
let cookie = "";

interface EnvOverrides {
	[key: string]: string;
}

function envFor(databasePath: string, dimensions = 64, overrides: EnvOverrides = {}) {
	return {
		NODE_ENV: "test",
		DATABASE_PATH: databasePath,
		AUTH_PASSWORD: "quotan",
		API_KEY,
		PUBLIC_ORIGIN: ORIGIN,
		EMBEDDING_PROVIDER: "mock",
		EMBEDDING_DIMENSIONS: String(dimensions),
		AUTO_REINDEX: "true",
		DOCS_ENABLED: "false",
		LOG_LEVEL: "silent",
		APP_TIMEZONE: "Asia/Singapore",
		...overrides,
	};
}

async function createApp(
	databasePath: string,
	dimensions = 64,
	overrides: EnvOverrides = {},
	startScheduler = false,
) {
	const config = loadConfig(envFor(databasePath, dimensions, overrides));
	const built = await buildApp(config, { startScheduler });
	return { ...built, config };
}

async function keyRequest(
	instance: FastifyInstance,
	method: "GET" | "POST" | "PATCH" | "DELETE",
	url: string,
	payload?: unknown,
) {
	return instance.inject({
		method,
		url,
		headers: { "x-api-key": API_KEY },
		...(payload !== undefined ? { payload: payload as object } : {}),
	});
}

function json(response: { body: string }) {
	return JSON.parse(response.body) as Record<string, unknown>;
}

async function login(instance: FastifyInstance): Promise<string> {
	const response = await instance.inject({
		method: "POST",
		url: "/api/auth/login",
		payload: { password: "quotan" },
	});
	expect(response.statusCode).toBe(200);
	const setCookie = response.headers["set-cookie"];
	const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
	const value = raw?.split(";")[0] ?? "";
	expect(value).toContain("quotan_session=");
	return value;
}

interface TelegramMock {
	base: string;
	requests: Array<Record<string, unknown>>;
	fail: boolean;
	close: () => Promise<void>;
}

async function startTelegramMock(): Promise<TelegramMock> {
	const mock: TelegramMock = {
		base: "",
		requests: [],
		fail: false,
		close: async () => {},
	};
	const server: Server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += String(chunk);
		});
		request.on("end", () => {
			try {
				mock.requests.push(JSON.parse(body) as Record<string, unknown>);
			} catch {
				mock.requests.push({ raw: body });
			}
			response.setHeader("Content-Type", "application/json");
			if (mock.fail) {
				response.statusCode = 502;
				response.end(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
				return;
			}
			response.statusCode = 200;
			response.end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
		});
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Mock server has no port");
	mock.base = `http://127.0.0.1:${address.port}`;
	mock.close = () =>
		new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	return mock;
}

function telegramEnv(mock: TelegramMock, overrides: EnvOverrides = {}): EnvOverrides {
	return {
		TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
		TELEGRAM_CHAT_ID: "123456789",
		TELEGRAM_API_BASE: mock.base,
		DAILY_SEND_TIME: "09:00",
		...overrides,
	};
}

beforeAll(async () => {
	directory = mkdtempSync(join(tmpdir(), "quotan-test-"));
	const built = await createApp(join(directory, "test.sqlite"));
	app = built.app;
	cookie = await login(app);
});

afterAll(async () => {
	await app.close();
	rmSync(directory, { recursive: true, force: true });
});

describe("configuration", () => {
	it("defaults to the in-process local model", () => {
		const databasePath = join(tmpdir(), "quotan-config-test", "data.sqlite");
		const config = loadConfig({
			NODE_ENV: "test",
			DATABASE_PATH: databasePath,
			AUTH_PASSWORD: "quotan",
			API_KEY,
			PUBLIC_ORIGIN: ORIGIN,
		});

		expect(config.embedding.provider).toBe("local");
		expect(config.embedding.model).toBe("onnx-community/granite-embedding-small-english-r2-ONNX");
		expect(config.embedding.dimensions).toBe(384);
		expect(config.embedding.maxChars).toBe(16000);
		expect(config.embedding.cacheDir).toBe(join(tmpdir(), "quotan-config-test", "models"));
		expect(config.telegram.enabled).toBe(false);
	});

	it("isolates long embedding inputs so they do not pad a whole batch", () => {
		expect(planEmbeddingBatches(["a", "b", "c"], 16)).toEqual([[0, 1, 2]]);
		expect(planEmbeddingBatches(["a", "b", "x".repeat(8001), "c"], 16)).toEqual([[0, 1], [2], [3]]);
		expect(
			planEmbeddingBatches(
				Array.from({ length: 20 }, () => "short"),
				16,
			),
		).toEqual([Array.from({ length: 16 }, (_, index) => index), [16, 17, 18, 19]]);
		expect(
			planEmbeddingBatches(
				Array.from({ length: 3 }, () => "x".repeat(9000)),
				16,
			),
		).toEqual([[0], [1], [2]]);
	});

	it("infers Telegram delivery when credentials are present", () => {
		const config = loadConfig(
			envFor(join(directory, "telegram-config.sqlite"), 64, {
				TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
				TELEGRAM_CHAT_ID: "123456789",
			}),
		);
		expect(config.telegram.enabled).toBe(true);
		expect(config.telegram.configured).toBe(true);
		expect(config.telegram.chatIdMasked).toBe("•••••6789");
		expect(config.telegram.sendTime).toBe("09:00");
	});

	it("fails fast on partial credentials or an invalid time", () => {
		expect(() =>
			loadConfig(
				envFor(join(directory, "partial.sqlite"), 64, { TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN }),
			),
		).toThrow(/must be set together/);
		expect(() =>
			loadConfig(envFor(join(directory, "partial2.sqlite"), 64, { TELEGRAM_CHAT_ID: "123456789" })),
		).toThrow(/must be set together/);
		expect(() =>
			loadConfig(
				envFor(
					join(directory, "badsend.sqlite"),
					64,
					telegramEnv({
						base: "https://api.telegram.org",
						requests: [],
						fail: false,
						close: async () => {},
					}),
				),
			),
		).not.toThrow();
		expect(() =>
			loadConfig(
				envFor(join(directory, "badsend2.sqlite"), 64, {
					TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
					TELEGRAM_CHAT_ID: "123",
					DAILY_SEND_TIME: "25:00",
				}),
			),
		).toThrow(/DAILY_SEND_TIME/);
	});

	it("treats blank credential placeholders as unset", () => {
		const config = loadConfig(
			envFor(join(directory, "blank.sqlite"), 64, {
				TELEGRAM_BOT_TOKEN: "",
				TELEGRAM_CHAT_ID: "",
			}),
		);
		expect(config.telegram.enabled).toBe(false);
		expect(config.telegram.configured).toBe(false);
	});

	it("can be explicitly disabled despite credentials", () => {
		const config = loadConfig(
			envFor(join(directory, "disabled.sqlite"), 64, {
				TELEGRAM_ENABLED: "false",
				TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
				TELEGRAM_CHAT_ID: "123456789",
			}),
		);
		expect(config.telegram.enabled).toBe(false);
		expect(config.telegram.configured).toBe(true);
	});
});

describe("auth", () => {
	it("rejects a wrong password", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/api/auth/login",
			payload: { password: "wrong" },
		});
		expect(response.statusCode).toBe(401);
	});

	it("reports the session", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/api/auth/me",
			headers: { cookie },
		});
		expect(response.statusCode).toBe(200);
		expect(json(response).authenticated).toBe(true);
	});

	it("requires auth for quotes", async () => {
		const response = await app.inject({ method: "GET", url: "/api/quotes" });
		expect(response.statusCode).toBe(401);
	});

	it("rejects a cookie mutation from another origin", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/api/quotes",
			headers: { cookie, origin: "http://evil.example" },
			payload: { text: "Blocked", author: "Tester" },
		});
		expect(response.statusCode).toBe(403);
	});
});

describe("quotes, statuses, and search", () => {
	it("creates a starred quote through the legacy alias and returns status", async () => {
		const response = await keyRequest(app, "POST", "/api/quotes", {
			text: "The unexamined life is not worth living.",
			author: "Socrates",
			starred: true,
		});
		expect(response.statusCode).toBe(201);
		const quote = json(response);
		expect(quote.id).toBe(1);
		expect(quote.status).toBe("starred");
		expect(quote.starred).toBeUndefined();
		expect(quote.droppedAt).toBeNull();
		expect(quote.dropSource).toBeNull();
		expect(typeof quote.createdAt).toBe("string");
		expect(quote.lastSentAt).toBeNull();
	});

	it("defaults new quotes to Inbox", async () => {
		const response = await keyRequest(app, "POST", "/api/quotes", {
			text: "We are what we repeatedly do.",
			author: "Aristotle",
		});
		expect(response.statusCode).toBe(201);
		expect(json(response).status).toBe("inbox");
	});

	it("finds an exact duplicate", async () => {
		const response = await keyRequest(app, "POST", "/api/duplicates/check", {
			text: "The unexamined life is not worth living",
			author: "Socrates",
		});
		expect(response.statusCode).toBe(200);
		const result = json(response) as { verdict: string; matches: unknown[] };
		expect(result.verdict).toBe("exact");
		expect(result.matches.length).toBeGreaterThan(0);
	});

	it("supports keyword search with FTS", async () => {
		const response = await keyRequest(app, "GET", "/api/search?q=unexamined");
		expect(response.statusCode).toBe(200);
		const result = json(response) as { items: Array<{ id: number }>; mode: string };
		expect(result.items.some((item) => item.id === 1)).toBe(true);
		expect(result.mode).toBe("hybrid");
	});

	it("filters by status and keeps the legacy starred alias", async () => {
		const byStatus = await keyRequest(app, "GET", "/api/quotes?status=starred");
		expect(
			(json(byStatus) as { items: Array<{ id: number }> }).items.map((item) => item.id),
		).toEqual([1]);
		const legacy = await keyRequest(app, "GET", "/api/quotes?starred=true");
		expect((json(legacy) as { items: Array<{ id: number }> }).items.map((item) => item.id)).toEqual(
			[1],
		);
		const inbox = await keyRequest(app, "GET", "/api/quotes?status=inbox");
		expect((json(inbox) as { items: Array<{ id: number }> }).items.map((item) => item.id)).toEqual([
			2,
		]);
		const rejected = await keyRequest(app, "GET", "/api/quotes?status=dropped");
		expect(rejected.statusCode).toBe(400);
	});

	it("moves a quote between active statuses", async () => {
		const toPrivate = await keyRequest(app, "PATCH", "/api/quotes/2", { status: "private" });
		expect(toPrivate.statusCode).toBe(200);
		expect(json(toPrivate).status).toBe("private");
		const privateList = await keyRequest(app, "GET", "/api/quotes?status=private");
		expect(
			(json(privateList) as { items: Array<{ id: number }> }).items.map((item) => item.id),
		).toEqual([2]);

		const backToInbox = await keyRequest(app, "PATCH", "/api/quotes/2", { status: "inbox" });
		expect(json(backToInbox).status).toBe("inbox");
	});

	it("updates FTS when text changes", async () => {
		const update = await keyRequest(app, "PATCH", "/api/quotes/2", {
			text: "Excellence is a habit, not an act.",
		});
		expect(update.statusCode).toBe(200);
		const oldSearch = await keyRequest(app, "GET", "/api/search?q=repeatedly");
		expect(
			(json(oldSearch) as { items: Array<{ id: number }> }).items.some((item) => item.id === 2),
		).toBe(false);
		const newSearch = await keyRequest(app, "GET", "/api/search?q=excellence");
		expect(
			(json(newSearch) as { items: Array<{ id: number }> }).items.some((item) => item.id === 2),
		).toBe(true);
	});

	it("paginates with cursors", async () => {
		for (let index = 0; index < 5; index += 1) {
			await keyRequest(app, "POST", "/api/quotes", {
				text: `Pagination quote number ${index}`,
				author: "Pager",
			});
		}
		const first = await keyRequest(app, "GET", "/api/quotes?limit=2&sort=newest");
		const firstBody = json(first) as { items: Array<{ id: number }>; nextCursor: string | null };
		expect(firstBody.items.length).toBe(2);
		expect(firstBody.nextCursor).toBeTruthy();
		const second = await keyRequest(
			app,
			"GET",
			`/api/quotes?limit=2&sort=newest&cursor=${firstBody.nextCursor}`,
		);
		const secondBody = json(second) as { items: Array<{ id: number }> };
		expect(secondBody.items.length).toBe(2);
		expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
	});

	it("archives a quote into Dropped instead of deleting it", async () => {
		const create = await keyRequest(app, "POST", "/api/quotes", {
			text: "A temporary quote to archive.",
			author: "Temp",
		});
		const id = (json(create) as { id: number }).id;
		const drop = await keyRequest(app, "DELETE", `/api/quotes/${id}`);
		expect(drop.statusCode).toBe(204);

		const detail = await keyRequest(app, "GET", `/api/quotes/${id}`);
		expect(detail.statusCode).toBe(404);
		const list = await keyRequest(app, "GET", "/api/quotes");
		const ids = (json(list) as { items: Array<{ id: number }> }).items.map((item) => item.id);
		expect(ids).not.toContain(id);
		const search = await keyRequest(app, "GET", "/api/search?q=temporary");
		expect(
			(json(search) as { items: Array<{ id: number }> }).items.some((item) => item.id === id),
		).toBe(false);

		const dropped = await keyRequest(app, "GET", "/api/dropped");
		const droppedItem = (json(dropped) as { items: Array<Record<string, unknown>> }).items.find(
			(item) => item.id === id,
		);
		expect(droppedItem?.status).toBe("dropped");
		expect(droppedItem?.droppedFrom).toBe("inbox");
		expect(droppedItem?.dropSource).toBe("quote");
		expect(typeof droppedItem?.droppedAt).toBe("string");

		const patch = await keyRequest(app, "PATCH", `/api/quotes/${id}`, { status: "inbox" });
		expect(patch.statusCode).toBe(404);

		const restore = await keyRequest(app, "POST", `/api/dropped/${id}/restore`, {
			status: "private",
		});
		expect(restore.statusCode).toBe(200);
		expect(json(restore).status).toBe("private");
		const restored = await keyRequest(app, "GET", `/api/quotes/${id}`);
		expect(restored.statusCode).toBe(200);
		const searchAgain = await keyRequest(app, "GET", "/api/search?q=temporary");
		expect(
			(json(searchAgain) as { items: Array<{ id: number }> }).items.some((item) => item.id === id),
		).toBe(true);
	});

	it("archives bulk selections, ignores missing ids, and removes them from search", async () => {
		const ids: number[] = [];
		for (const text of ["Bulk archive alpha", "Bulk archive beta", "Bulk archive gamma"]) {
			const created = await keyRequest(app, "POST", "/api/quotes", {
				text,
				author: "Archiver",
			});
			ids.push((json(created) as { id: number }).id);
		}

		const response = await keyRequest(app, "POST", "/api/quotes/bulk-delete", {
			ids: [ids[0], ids[1], 99999],
			source: "duplicates",
		});
		expect(response.statusCode).toBe(200);
		expect(json(response).archived).toBe(2);

		const list = await keyRequest(app, "GET", "/api/quotes");
		const remaining = (json(list) as { items: Array<{ id: number }> }).items.map((item) => item.id);
		expect(remaining).toContain(ids[2]);
		expect(remaining).not.toContain(ids[0]);

		const dropped = await keyRequest(app, "GET", "/api/dropped?q=bulk");
		const items = (json(dropped) as { items: Array<{ id: number; dropSource: string }> }).items;
		expect(items.map((item) => item.id).sort()).toEqual([ids[0], ids[1]].sort());
		expect(items.every((item) => item.dropSource === "duplicates")).toBe(true);
	});
});

describe("import and export", () => {
	it("imports direct rows, skips in-batch duplicates, and remains idempotent", async () => {
		const rows = [
			{ text: "A fresh imported quote.", author: "Importer" },
			{ text: "A fresh imported quote.", author: "Importer" },
			{ text: "A private imported quote.", author: "Importer", status: "private" },
			{ text: "A legacy starred import.", author: "Importer", starred: true },
			{ text: "   ", author: "Nobody" },
		];
		const batchId = "test-batch-idempotent";
		const commit = await keyRequest(app, "POST", "/api/import", { batchId, rows });
		expect(commit.statusCode).toBe(200);
		const report = json(commit) as {
			imported: number;
			invalid: number;
			skippedDuplicates: number;
			skippedDropped: number;
			importedIds: number[];
			rows: Array<{ index: number; duplicateOfId?: number }>;
		};
		expect(report.imported).toBe(3);
		expect(report.invalid).toBe(1);
		expect(report.skippedDuplicates).toBe(1);
		expect(report.skippedDropped).toBe(0);
		expect(report.importedIds).toHaveLength(3);
		expect(report.rows[1]?.duplicateOfId).toBe(report.importedIds[0]);

		const again = await keyRequest(app, "POST", "/api/import", { batchId, rows });
		expect(json(again)).toEqual(report);

		const privateList = await keyRequest(app, "GET", "/api/quotes?status=private");
		expect(
			(json(privateList) as { items: Array<{ author: string }> }).items.some(
				(item) => item.author === "Importer",
			),
		).toBe(true);
		const starredList = await keyRequest(app, "GET", "/api/quotes?status=starred");
		expect(
			(json(starredList) as { items: Array<{ text: string }> }).items.some(
				(item) => item.text === "A legacy starred import.",
			),
		).toBe(true);
	});

	it("skips exact duplicates of active and Dropped quotes", async () => {
		const droppedCreate = await keyRequest(app, "POST", "/api/quotes", {
			text: "An archived import guard.",
			author: "Guard",
		});
		const droppedId = (json(droppedCreate) as { id: number }).id;
		expect((await keyRequest(app, "DELETE", `/api/quotes/${droppedId}`)).statusCode).toBe(204);

		const response = await keyRequest(app, "POST", "/api/import", {
			batchId: "test-batch-dropped-guard",
			rows: [
				{ text: "An archived import guard.", author: "Guard" },
				{ text: "The unexamined life is not worth living.", author: "Socrates" },
			],
		});
		const report = json(response) as {
			imported: number;
			skippedDropped: number;
			skippedDuplicates: number;
			rows: Array<{ duplicateOfStatus?: string; duplicateOfId?: number }>;
		};
		expect(report.imported).toBe(0);
		expect(report.skippedDropped).toBe(1);
		expect(report.skippedDuplicates).toBe(1);
		expect(report.rows[0]?.duplicateOfStatus).toBe("dropped");
		expect(report.rows[0]?.duplicateOfId).toBe(droppedId);
	});

	it("rejects restore when an active exact duplicate exists", async () => {
		const first = await keyRequest(app, "POST", "/api/quotes", {
			text: "Restore conflict quote.",
			author: "Conflict",
		});
		const firstId = (json(first) as { id: number }).id;
		await keyRequest(app, "DELETE", `/api/quotes/${firstId}`);
		const second = await keyRequest(app, "POST", "/api/quotes", {
			text: "Restore conflict quote.",
			author: "Conflict",
		});
		expect(second.statusCode).toBe(201);
		const restore = await keyRequest(app, "POST", `/api/dropped/${firstId}/restore`, {
			status: "inbox",
		});
		expect(restore.statusCode).toBe(409);
	});

	it("makes a permanently deleted quote importable again", async () => {
		const create = await keyRequest(app, "POST", "/api/quotes", {
			text: "Permanently removed guard.",
			author: "Guard",
		});
		const id = (json(create) as { id: number }).id;
		await keyRequest(app, "DELETE", `/api/quotes/${id}`);
		const permanent = await keyRequest(app, "DELETE", `/api/dropped/${id}`);
		expect(permanent.statusCode).toBe(204);
		const list = await keyRequest(app, "GET", "/api/dropped?q=permanently");
		expect((json(list) as { items: unknown[] }).items).toHaveLength(0);

		const imported = await keyRequest(app, "POST", "/api/import", {
			batchId: "test-batch-after-permanent-delete",
			rows: [{ text: "Permanently removed guard.", author: "Guard" }],
		});
		expect((json(imported) as { imported: number }).imported).toBe(1);
	});

	it("exports active JSON and CSV with a status column", async () => {
		const jsonResponse = await keyRequest(app, "GET", "/api/quotes/export?format=json");
		expect(jsonResponse.statusCode).toBe(200);
		const envelope = JSON.parse(jsonResponse.body) as {
			count: number;
			quotes: Array<{ status: string }>;
		};
		expect(envelope.count).toBeGreaterThan(0);
		expect(envelope.quotes.length).toBe(envelope.count);
		expect(envelope.quotes.every((quote) => quote.status !== "dropped")).toBe(true);

		const csvResponse = await keyRequest(app, "GET", "/api/quotes/export?format=csv");
		expect(csvResponse.statusCode).toBe(200);
		const header = csvResponse.body.split("\r\n")[0];
		expect(header).toContain("text,author,status");
		expect(header).not.toContain("starred");
	});

	it("filters exports by status", async () => {
		const response = await keyRequest(app, "GET", "/api/quotes/export?format=json&status=private");
		const envelope = JSON.parse(response.body) as { quotes: Array<{ status: string }> };
		expect(envelope.quotes.length).toBeGreaterThan(0);
		expect(envelope.quotes.every((quote) => quote.status === "private")).toBe(true);
	});
});

describe("daily lifecycle", () => {
	it("records the deterministic pair and auto-archives the Inbox quote", async () => {
		const preview = await keyRequest(app, "GET", "/api/daily/preview");
		const previewBody = json(preview) as {
			starred: { id: number } | null;
			unstarred: { id: number } | null;
		};
		expect(previewBody.starred).not.toBeNull();
		expect(previewBody.unstarred).not.toBeNull();

		const commit = await keyRequest(app, "POST", "/api/daily", { channel: "test" });
		const commitBody = json(commit) as {
			alreadyExisted: boolean;
			batch: {
				sendState: string;
				sentAt: string | null;
				starred: { id: number; status: string };
				unstarred: {
					id: number;
					status: string;
					droppedAt: string | null;
					droppedFrom: string | null;
					dropSource: string | null;
				};
			};
		};
		expect(commitBody.alreadyExisted).toBe(false);
		expect(commitBody.batch.sendState).toBe("sent");
		expect(commitBody.batch.sentAt).toBeTruthy();
		expect(commitBody.batch.starred.id).toBe(previewBody.starred?.id);
		expect(commitBody.batch.unstarred.id).toBe(previewBody.unstarred?.id);
		expect(commitBody.batch.unstarred.status).toBe("dropped");
		expect(commitBody.batch.unstarred.droppedFrom).toBe("inbox");
		expect(commitBody.batch.unstarred.dropSource).toBe("daily");

		const daily = await keyRequest(app, "GET", "/api/daily");
		const batch = json(daily).batch as {
			starred: { id: number };
			unstarred: { id: number; status: string };
		};
		expect(batch.starred.id).toBe(previewBody.starred?.id);
		expect(batch.unstarred.id).toBe(previewBody.unstarred?.id);
		expect(batch.unstarred.status).toBe("dropped");

		const again = await keyRequest(app, "POST", "/api/daily", { channel: "test" });
		expect((json(again) as { alreadyExisted: boolean }).alreadyExisted).toBe(true);

		const deliveries = await keyRequest(app, "GET", "/api/deliveries");
		expect((json(deliveries) as { items: unknown[] }).items.length).toBe(2);
	});

	it("keeps the auto-dropped Inbox quote recoverable from Today", async () => {
		const daily = await keyRequest(app, "GET", "/api/daily");
		const batch = json(daily).batch as { unstarred: { id: number } };
		const restore = await keyRequest(app, "POST", `/api/dropped/${batch.unstarred.id}/restore`, {
			status: "starred",
		});
		expect(restore.statusCode).toBe(200);
		expect(json(restore).status).toBe("starred");
		const updated = await keyRequest(app, "GET", "/api/daily");
		expect((json(updated).batch as { unstarred: { status: string } }).unstarred.status).toBe(
			"starred",
		);
	});

	it("reports status counts in stats without counting Dropped as active", async () => {
		const response = await keyRequest(app, "GET", "/api/stats");
		const stats = json(response) as {
			totals: {
				quotes: number;
				starred: number;
				inbox: number;
				private: number;
				dropped: number;
			};
			index: { state: string };
		};
		expect(stats.totals.dropped).toBeGreaterThan(0);
		expect(stats.totals.quotes).toBe(
			stats.totals.starred + stats.totals.inbox + stats.totals.private,
		);
		expect(stats.index.state).toBe("ready");
	});

	it("downloads a valid SQLite backup", async () => {
		const response = await keyRequest(app, "GET", "/api/admin/backup");
		expect(response.statusCode).toBe(200);
		expect(response.rawPayload.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
	});
});

describe("telegram delivery", () => {
	it("sends one escaped message, auto-drops Inbox, and is idempotent", async () => {
		const mock = await startTelegramMock();
		const built = await createApp(
			join(directory, "telegram-success.sqlite"),
			64,
			telegramEnv(mock),
		);
		try {
			const starred = await keyRequest(built.app, "POST", "/api/quotes", {
				text: "A <starred> & quoted line.",
				author: "Author <One>",
				status: "starred",
			});
			const inbox = await keyRequest(built.app, "POST", "/api/quotes", {
				text: "An inbox quote with & symbols.",
				author: "Author Two",
			});
			const starredId = (json(starred) as { id: number }).id;
			const inboxId = (json(inbox) as { id: number }).id;

			const send = await keyRequest(built.app, "POST", "/api/daily/send");
			expect(send.statusCode).toBe(200);
			const body = json(send) as {
				alreadySent: boolean;
				batch: {
					sendState: string;
					telegramMessageId: number | null;
					starred: { id: number };
					unstarred: { id: number; status: string };
				};
			};
			expect(body.alreadySent).toBe(false);
			expect(body.batch.sendState).toBe("sent");
			expect(body.batch.telegramMessageId).toBe(42);
			expect(body.batch.starred.id).toBe(starredId);
			expect(body.batch.unstarred.id).toBe(inboxId);
			expect(body.batch.unstarred.status).toBe("dropped");

			expect(mock.requests).toHaveLength(1);
			const payload = mock.requests[0] as {
				text: string;
				parse_mode: string;
				chat_id: string;
				disable_web_page_preview: boolean;
			};
			expect(payload.chat_id).toBe("123456789");
			expect(payload.parse_mode).toBe("HTML");
			expect(payload.disable_web_page_preview).toBe(true);
			expect(payload.text).toContain("A &lt;starred&gt; &amp; quoted line.");
			expect(payload.text).toContain("Author &lt;One&gt;");
			expect(payload.text).toContain("An inbox quote with &amp; symbols.");
			expect(payload.text).toContain(`${ORIGIN}/today`);
			expect(payload.text).toContain("📥");

			const settings = await keyRequest(built.app, "GET", "/api/settings");
			const settingsBody = json(settings) as {
				telegram: { enabled: boolean; configured: boolean; chatIdMasked: string | null };
				version: string;
			};
			expect(settingsBody.telegram.enabled).toBe(true);
			expect(settingsBody.telegram.chatIdMasked).toBe("•••••6789");
			expect(settingsBody.version).toBe("0.1.0");
			expect(settings.body).not.toContain(TELEGRAM_TOKEN);

			const again = await keyRequest(built.app, "POST", "/api/daily/send");
			expect((json(again) as { alreadySent: boolean }).alreadySent).toBe(true);
			expect(mock.requests).toHaveLength(1);
		} finally {
			await built.app.close();
			await mock.close();
		}
	});

	it("keeps the batch pending and the Inbox quote active on failure, then retries", async () => {
		const mock = await startTelegramMock();
		mock.fail = true;
		const built = await createApp(join(directory, "telegram-fail.sqlite"), 64, telegramEnv(mock));
		try {
			const inbox = await keyRequest(built.app, "POST", "/api/quotes", {
				text: "Retry this Inbox quote.",
				author: "Retry",
			});
			await keyRequest(built.app, "POST", "/api/quotes", {
				text: "A starred companion.",
				author: "Retry",
				status: "starred",
			});
			const inboxId = (json(inbox) as { id: number }).id;

			const failed = await keyRequest(built.app, "POST", "/api/daily/send");
			expect(failed.statusCode).toBe(502);
			expect(failed.body).not.toContain(TELEGRAM_TOKEN);

			const afterFailure = await keyRequest(built.app, "GET", "/api/daily");
			const failedBatch = json(afterFailure).batch as {
				sendState: string;
				attempts: number;
				lastError: string | null;
				unstarred: { id: number; status: string };
			};
			expect(failedBatch.sendState).toBe("pending");
			expect(failedBatch.attempts).toBe(1);
			expect(failedBatch.lastError).toContain("chat not found");
			expect(failedBatch.lastError).not.toContain(TELEGRAM_TOKEN);
			expect(failedBatch.unstarred.status).toBe("inbox");

			const inboxDetail = await keyRequest(built.app, "GET", `/api/quotes/${inboxId}`);
			expect(inboxDetail.statusCode).toBe(200);
			expect(json(inboxDetail).status).toBe("inbox");

			mock.fail = false;
			const retry = await keyRequest(built.app, "POST", "/api/daily/send");
			expect(retry.statusCode).toBe(200);
			const retryBody = json(retry) as {
				batch: { sendState: string; attempts: number; unstarred: { status: string } };
			};
			expect(retryBody.batch.sendState).toBe("sent");
			expect(retryBody.batch.attempts).toBe(2);
			expect(retryBody.batch.unstarred.status).toBe("dropped");
			expect(mock.requests).toHaveLength(2);
		} finally {
			await built.app.close();
			await mock.close();
		}
	});

	it("returns 400 when Telegram is not configured", async () => {
		const response = await keyRequest(app, "POST", "/api/daily/send");
		expect(response.statusCode).toBe(400);
	});
});

describe("daily scheduler", () => {
	it("waits for the send time, sends once, and honours the retry interval", async () => {
		const mock = await startTelegramMock();
		mock.fail = true;
		const built = await createApp(
			join(directory, "scheduler.sqlite"),
			64,
			telegramEnv(mock, { DAILY_SEND_TIME: "09:00", DAILY_SEND_RETRY_SECONDS: "300" }),
		);
		try {
			await keyRequest(built.app, "POST", "/api/quotes", {
				text: "Scheduler inbox quote.",
				author: "Scheduler",
			});
			await keyRequest(built.app, "POST", "/api/quotes", {
				text: "Scheduler starred quote.",
				author: "Scheduler",
				status: "starred",
			});
			const telegram = new TelegramService(built.config.telegram);
			// 12:00 Asia/Singapore.
			const noon = new Date("2026-11-02T04:00:00Z");
			let current = noon;
			const daily = new DailyService(
				built.handle,
				built.config,
				telegram,
				built.embeddings,
				() => current,
			);
			const scheduler = new DailyScheduler(daily, built.config, built.app.log);

			const early = new Date("2026-11-02T00:30:00Z"); // 08:30 local
			await scheduler.tick(early);
			expect(mock.requests).toHaveLength(0);

			built.config.telegram.sendTime = "23:59";
			await scheduler.tick(noon);
			expect(mock.requests).toHaveLength(0);
			built.config.telegram.sendTime = "09:00";

			await scheduler.tick(noon);
			expect(mock.requests).toHaveLength(1);
			const pending = daily.get("2026-11-02");
			expect(pending?.sendState).toBe("pending");

			// Immediate retry is suppressed by the retry interval.
			await scheduler.tick(noon);
			expect(mock.requests).toHaveLength(1);

			mock.fail = false;
			current = new Date(noon.getTime() + 301_000);
			await scheduler.tick(current);
			expect(mock.requests).toHaveLength(2);
			expect(daily.get("2026-11-02")?.sendState).toBe("sent");

			// A sent day is never sent twice.
			await scheduler.tick(new Date(noon.getTime() + 600_000));
			expect(mock.requests).toHaveLength(2);

			// The next day selects new quotes and sends again.
			current = new Date("2026-11-03T04:00:00Z");
			await scheduler.tick(current);
			expect(mock.requests).toHaveLength(3);
		} finally {
			await built.app.close();
			await mock.close();
		}
	});

	it("is a no-op when Telegram is disabled", async () => {
		const built = await createApp(join(directory, "scheduler-disabled.sqlite"));
		try {
			const telegram = new TelegramService(built.config.telegram);
			const daily = new DailyService(built.handle, built.config, telegram, built.embeddings);
			const scheduler = new DailyScheduler(daily, built.config, built.app.log);
			await expect(scheduler.tick(new Date("2026-11-02T04:00:00Z"))).resolves.toBeUndefined();
		} finally {
			await built.app.close();
		}
	});
});

describe("migration", () => {
	it("backfills status from starred, removes the column, and keeps foreign keys valid", async () => {
		const path = join(directory, "migration.sqlite");
		const legacy = new Database(path);
		legacy.exec(MIGRATIONS[0]?.sql ?? "");
		legacy.exec(MIGRATIONS[1]?.sql ?? "");
		legacy.pragma("user_version = 2");
		legacy
			.prepare(
				`INSERT INTO quotes(text, author, starred, text_key, author_key, dedupe_key, created_at, updated_at)
				 VALUES(?, ?, 1, ?, ?, ?, ?, ?)`,
			)
			.run(
				"Legacy starred",
				"Legacy",
				"legacy starred",
				"legacy",
				"legacy|legacy",
				"2026-01-01T00:00:00.000Z",
				"2026-01-01T00:00:00.000Z",
			);
		legacy.close();

		const migrated = openDatabase(path);
		try {
			const row = migrated.sqlite
				.prepare("SELECT status FROM quotes WHERE author = 'Legacy'")
				.get() as { status: string };
			expect(row.status).toBe("starred");
			const columns = migrated.sqlite.prepare("PRAGMA table_info(quotes)").all() as Array<{
				name: string;
			}>;
			expect(columns.some((column) => column.name === "starred")).toBe(false);
			expect(columns.some((column) => column.name === "status")).toBe(true);
			expect(columns.some((column) => column.name === "dropped_from")).toBe(true);
			const indexes = migrated.sqlite.prepare("PRAGMA index_list(quotes)").all() as Array<{
				name: string;
			}>;
			expect(indexes.some((index) => index.name === "idx_quotes_status_last_sent")).toBe(true);
			const checks = migrated.sqlite.prepare("PRAGMA foreign_key_check").all();
			expect(checks).toHaveLength(0);
			const version = migrated.sqlite.pragma("user_version", { simple: true });
			expect(version).toBe(4);
		} finally {
			migrated.close();
		}
	});

	it("upgrades a version-3 database that predates dropped_from", async () => {
		const path = join(directory, "migration-v3.sqlite");
		const legacy = new Database(path);
		legacy.exec(MIGRATIONS[0]?.sql ?? "");
		legacy.exec(MIGRATIONS[1]?.sql ?? "");
		legacy.exec(MIGRATIONS[2]?.sql ?? "");
		legacy.pragma("user_version = 3");
		legacy
			.prepare(
				`INSERT INTO quotes(text, author, status, text_key, author_key, dedupe_key, created_at, updated_at)
				 VALUES(?, ?, 'starred', ?, ?, ?, ?, ?)`,
			)
			.run(
				"A version three quote",
				"Legacy",
				"a version three quote",
				"legacy",
				"legacy|legacy",
				"2026-01-01T00:00:00.000Z",
				"2026-01-01T00:00:00.000Z",
			);
		legacy.close();

		const migrated = openDatabase(path);
		try {
			const columns = migrated.sqlite.prepare("PRAGMA table_info(quotes)").all() as Array<{
				name: string;
			}>;
			expect(columns.some((column) => column.name === "dropped_from")).toBe(true);
			const row = migrated.sqlite
				.prepare("SELECT status, dropped_from FROM quotes WHERE author = 'Legacy'")
				.get() as { status: string; dropped_from: string | null };
			expect(row.status).toBe("starred");
			expect(row.dropped_from).toBeNull();
			expect(migrated.sqlite.pragma("user_version", { simple: true })).toBe(4);
		} finally {
			migrated.close();
		}
	});
});

describe("model changes", () => {
	it("reindexes when embedding dimensions change and excludes dropped quotes", async () => {
		const modelPath = join(directory, "model.sqlite");
		const first = await createApp(modelPath, 64);
		const created = await first.app.inject({
			method: "POST",
			url: "/api/quotes",
			headers: { "x-api-key": API_KEY },
			payload: { text: "A quote that survives a model change.", author: "Tester" },
		});
		expect(created.statusCode).toBe(201);
		const dropped = await first.app.inject({
			method: "POST",
			url: "/api/quotes",
			headers: { "x-api-key": API_KEY },
			payload: { text: "A dropped quote that must stay unindexed.", author: "Tester" },
		});
		const droppedId = (json(dropped) as { id: number }).id;
		await first.app.inject({
			method: "DELETE",
			url: `/api/quotes/${droppedId}`,
			headers: { "x-api-key": API_KEY },
		});
		await first.app.close();

		const second = await createApp(modelPath, 32);
		await second.embeddings.waitForIdle();
		const status = second.embeddings.status();
		expect(status.dimensions).toBe(32);
		expect(status.state).toBe("ready");
		expect(status.pending).toBe(0);
		expect(status.total).toBe(1);
		const search = await second.app.inject({
			method: "GET",
			url: "/api/search?q=model",
			headers: { "x-api-key": API_KEY },
		});
		expect(search.statusCode).toBe(200);
		expect((json(search) as { mode: string }).mode).toBe("hybrid");
		await second.app.close();
	});
});

describe("duplicate scan", () => {
	it("groups exact, same-text, and near-text duplicates", async () => {
		const scanPath = join(directory, "scan.sqlite");
		const built = await createApp(scanPath);
		try {
			for (const payload of [
				{ text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
				{ text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
				{ text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
				{ text: "Simplicity is the ultimate sophistication.", author: "Anonymous" },
				{
					text: "The journey of a thousand miles begins with a single step.",
					author: "Lao Tzu",
				},
				{
					text: "The journey of a thousand miles begins with one step.",
					author: "Laozi",
				},
				{ text: "An archived quote must not be scanned.", author: "Archived" },
			]) {
				const created = await keyRequest(built.app, "POST", "/api/quotes", payload);
				expect(created.statusCode).toBe(201);
				if (payload.author === "Archived") {
					const id = (json(created) as { id: number }).id;
					await keyRequest(built.app, "DELETE", `/api/quotes/${id}`);
				}
			}

			const response = await keyRequest(built.app, "GET", "/api/duplicates?limit=50");
			expect(response.statusCode).toBe(200);
			const body = json(response) as {
				groups: Array<{
					key: string;
					category: string;
					ignored: boolean;
					quotes: Array<{ id: number }>;
				}>;
				totalGroups: number;
				scanned: number;
				totalQuotes: number;
			};
			const categories = new Set(body.groups.map((group) => group.category));
			expect(categories.has("exact")).toBe(true);
			expect(categories.has("same_text")).toBe(true);
			expect(categories.has("likely")).toBe(true);
			expect(body.scanned).toBe(6);
			expect(body.totalQuotes).toBe(6);
			expect(body.totalGroups).toBeGreaterThanOrEqual(3);
			expect(body.groups.every((group) => !group.ignored)).toBe(true);

			const exactGroup = body.groups.find((group) => group.category === "exact");
			expect(exactGroup).toBeDefined();
			const ignore = await keyRequest(built.app, "POST", "/api/duplicates/ignore", {
				key: exactGroup?.key,
				ignored: true,
			});
			expect(ignore.statusCode).toBe(200);
			expect(json(ignore).ignored).toBe(true);

			const ignoredScan = await keyRequest(built.app, "GET", "/api/duplicates?limit=50");
			const ignoredGroups = (json(ignoredScan) as { groups: typeof body.groups }).groups;
			expect(ignoredGroups.find((group) => group.key === exactGroup?.key)?.ignored).toBe(true);

			const unignore = await keyRequest(built.app, "POST", "/api/duplicates/ignore", {
				key: exactGroup?.key,
				ignored: false,
			});
			expect(unignore.statusCode).toBe(200);
			expect(json(unignore).ignored).toBe(false);
		} finally {
			await built.app.close();
		}
	});

	it("merges strong near duplicates into one cluster", async () => {
		const scanPath = join(directory, "scan-cluster.sqlite");
		// Without vectors, near-identical text is the only merge signal, so the
		// trigram fallback can be exercised deterministically.
		const built = await createApp(scanPath, 64, {
			EMBEDDING_PROVIDER: "none",
			DUPLICATE_CLUSTER_TRIGRAM: "0.95",
		});
		try {
			for (const suffix of ["1", "2", "3"]) {
				const created = await keyRequest(built.app, "POST", "/api/quotes", {
					text: `Alpha beta gamma delta ${suffix}`,
					author: "Cluster Author",
				});
				expect(created.statusCode).toBe(201);
			}

			const response = await keyRequest(built.app, "GET", "/api/duplicates?limit=50");
			expect(response.statusCode).toBe(200);
			const body = json(response) as {
				groups: Array<{ key: string; category: string; quotes: Array<{ id: number }> }>;
				totalGroups: number;
			};
			expect(body.totalGroups).toBe(1);
			expect(body.groups).toHaveLength(1);
			expect(body.groups[0]?.category).toBe("likely");
			expect(body.groups[0]?.quotes).toHaveLength(3);
			expect(body.groups[0]?.key.startsWith("cluster:")).toBe(true);
		} finally {
			await built.app.close();
		}
	});

	it("requires complete linkage instead of chaining through one member", async () => {
		const scanPath = join(directory, "scan-complete-linkage.sqlite");
		// Without vectors the trigram thresholds are deterministic. The one/three
		// pair is below the merge bar, so {A,D} and {B,C} must stay separate even
		// though B matches both sides of the chain.
		const built = await createApp(scanPath, 64, {
			EMBEDDING_PROVIDER: "none",
			DUPLICATE_CLUSTER_TRIGRAM: "0.86",
		});
		try {
			for (const [text, author] of [
				["Alpha beta gamma delta one", "Author A"],
				["Alpha beta gamma delta one", "Author A"],
				["Alpha beta gamma delta two", "Author B"],
				["Alpha beta gamma delta three", "Author C"],
			]) {
				const created = await keyRequest(built.app, "POST", "/api/quotes", { text, author });
				expect(created.statusCode).toBe(201);
			}

			const response = await keyRequest(built.app, "GET", "/api/duplicates?limit=50");
			expect(response.statusCode).toBe(200);
			const body = json(response) as {
				groups: Array<{ quotes: Array<{ id: number }> }>;
				totalGroups: number;
			};
			expect(body.totalGroups).toBe(2);
			expect(body.groups.map((group) => group.quotes.length).sort()).toEqual([2, 2]);
		} finally {
			await built.app.close();
		}
	});

	it("does not chain trigram-only near matches into one giant group", async () => {
		const scanPath = join(directory, "scan-no-chain.sqlite");
		const built = await createApp(scanPath);
		try {
			for (let index = 1; index <= 6; index += 1) {
				const created = await keyRequest(built.app, "POST", "/api/quotes", {
					text: `Jump to end quote ${index}`,
					author: "Template Author",
				});
				expect(created.statusCode).toBe(201);
			}

			const response = await keyRequest(built.app, "GET", "/api/duplicates?limit=50");
			expect(response.statusCode).toBe(200);
			const body = json(response) as {
				groups: Array<{ category: string; quotes: Array<{ id: number }> }>;
				totalGroups: number;
			};
			// Six mutually similar templates would formerly produce 15 pair cards.
			// Weak edges are shown once per quote, and none of them merge.
			expect(body.totalGroups).toBe(3);
			expect(body.groups.every((group) => group.quotes.length === 2)).toBe(true);
			expect(body.groups.every((group) => group.category === "likely")).toBe(true);
		} finally {
			await built.app.close();
		}
	});

	it("scans every quote in libraries larger than the former 2,000 cap", async () => {
		const scanPath = join(directory, "scan-large.sqlite");
		const built = await createApp(scanPath);
		try {
			built.handle.sqlite.transaction(() => {
				for (let index = 0; index < 2001; index += 1) {
					insertQuoteRaw(built.handle, {
						text: `Quotation${String(index).padStart(4, "0")}`,
						author: "Bulk Author",
					});
				}
			})();

			const response = await keyRequest(built.app, "GET", "/api/duplicates");
			expect(response.statusCode).toBe(200);
			const body = json(response) as {
				totalGroups: number;
				scanned: number;
				totalQuotes: number;
			};
			expect(body.scanned).toBe(2001);
			expect(body.totalQuotes).toBe(2001);
			expect(body.totalGroups).toBe(0);
		} finally {
			await built.app.close();
		}
	}, 20_000);
});

describe("content length", () => {
	it("accepts quotes and authors longer than the former UI limits", async () => {
		const text = `A long quote: ${"patience ".repeat(700)}`.trim();
		const author = "A".repeat(250);
		const response = await keyRequest(app, "POST", "/api/quotes", { text, author });
		expect(response.statusCode).toBe(201);
		const body = json(response) as { text: string; author: string };
		expect(body.text).toBe(text);
		expect(body.author).toBe(author);
	});
});
