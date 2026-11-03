import type {
	ActiveQuoteStatus,
	DropSource,
	ManualDropSource,
	Quote,
	QuoteListResponse,
	QuoteStatus,
} from "@quotan/shared";
import type Database from "better-sqlite3";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { normalizeAuthorKey, normalizeTextKey, quoteKeys } from "../lib/normalize.js";
import { nowIso } from "../lib/time.js";
import type { Db } from "./index.js";
import { ftsDelete, ftsInsert } from "./index.js";
import type { QuoteRow } from "./schema.js";

export interface QuoteFilters {
	status?: QuoteStatus;
	sent?: boolean;
	author?: string;
	from?: string;
	to?: string;
}

export interface QuoteListOptions extends QuoteFilters {
	sort?: "newest" | "oldest" | "author" | "last_sent";
	cursor?: string;
	limit?: number;
}

interface RawQuoteRow {
	id: number;
	text: string;
	author: string;
	status: string;
	dropped_at: string | null;
	dropped_from: string | null;
	drop_source: string | null;
	text_key: string;
	author_key: string;
	dedupe_key: string;
	last_sent_at: string | null;
	sent_count: number;
	created_at: string;
	updated_at: string;
}

export function mapQuoteRow(raw: RawQuoteRow): QuoteRow {
	return {
		id: raw.id,
		text: raw.text,
		author: raw.author,
		status: raw.status as QuoteStatus,
		droppedAt: raw.dropped_at,
		droppedFrom: raw.dropped_from as ActiveQuoteStatus | null,
		dropSource: raw.drop_source as DropSource | null,
		textKey: raw.text_key,
		authorKey: raw.author_key,
		dedupeKey: raw.dedupe_key,
		lastSentAt: raw.last_sent_at,
		sentCount: raw.sent_count,
		createdAt: raw.created_at,
		updatedAt: raw.updated_at,
	};
}

export function listAllQuoteRows(
	handle: { sqlite: Database.Database },
	options: { includeDropped?: boolean } = {},
): QuoteRow[] {
	const where = options.includeDropped ? "" : "WHERE status != 'dropped'";
	const rows = handle.sqlite
		.prepare(`SELECT * FROM quotes ${where} ORDER BY id DESC`)
		.all() as RawQuoteRow[];
	return rows.map(mapQuoteRow);
}

export function rowToQuote(row: QuoteRow): Quote {
	return {
		id: row.id,
		text: row.text,
		author: row.author,
		status: row.status,
		droppedAt: row.droppedAt,
		droppedFrom: row.droppedFrom,
		dropSource: row.dropSource,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastSentAt: row.lastSentAt,
		sentCount: row.sentCount,
	};
}

function filterClause(filters: QuoteFilters): { sql: string; params: unknown[] } {
	const clauses: string[] = [];
	const params: unknown[] = [];
	if (filters.status !== undefined) {
		clauses.push("q.status = ?");
		params.push(filters.status);
	} else {
		// Active-query rule: everything except the Dropped archive.
		clauses.push("q.status != 'dropped'");
	}
	if (filters.sent !== undefined) {
		clauses.push(filters.sent ? "q.last_sent_at IS NOT NULL" : "q.last_sent_at IS NULL");
	}
	if (filters.author) {
		clauses.push("q.author_key LIKE ?");
		params.push(`%${normalizeAuthorKey(filters.author)}%`);
	}
	if (filters.from) {
		clauses.push("q.created_at >= ?");
		params.push(filters.from);
	}
	if (filters.to) {
		clauses.push("q.created_at <= ?");
		params.push(filters.to);
	}
	return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function quoteFilterSql(filters: QuoteFilters): { sql: string; params: unknown[] } {
	return filterClause(filters);
}

function newQuoteRow(
	text: string,
	author: string,
	status: ActiveQuoteStatus,
	at: string,
): Omit<QuoteRow, "id"> {
	const keys = quoteKeys(text, author);
	return {
		text,
		author,
		status,
		droppedAt: null,
		droppedFrom: null,
		dropSource: null,
		textKey: keys.textKey,
		authorKey: keys.authorKey,
		dedupeKey: keys.dedupeKey,
		lastSentAt: null,
		sentCount: 0,
		createdAt: at,
		updatedAt: at,
	};
}

export interface InsertQuoteInput {
	text: string;
	author: string;
	status?: ActiveQuoteStatus;
	createdAt?: string;
}

/** Insert a quote and its FTS row. Caller must provide the surrounding transaction. */
export function insertQuoteRaw(
	handle: { sqlite: Database.Database },
	input: InsertQuoteInput,
): { id: number; quote: Quote } {
	const text = input.text.trim();
	const author = input.author.trim();
	const at = input.createdAt ?? nowIso();
	const row = newQuoteRow(text, author, input.status ?? "inbox", at);
	const inserted = handle.sqlite
		.prepare(
			`INSERT INTO quotes(text, author, status, text_key, author_key, dedupe_key, created_at, updated_at)
			 VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			row.text,
			row.author,
			row.status,
			row.textKey,
			row.authorKey,
			row.dedupeKey,
			row.createdAt,
			row.updatedAt,
		);
	const id = Number(inserted.lastInsertRowid);
	ftsInsert(handle.sqlite, id, row.text, row.author);
	const quote = getQuoteById(handle, id);
	if (!quote) throw new Error("Failed to read quote after insert");
	return { id, quote };
}

export function createQuote(
	handle: { sqlite: Database.Database; db: Db },
	input: InsertQuoteInput,
): Quote {
	return handle.sqlite.transaction(() => insertQuoteRaw(handle, input).quote)();
}

/** Active quotes only; Dropped is reached through the archive endpoints. */
export function getQuoteById(handle: { sqlite: Database.Database }, id: number): Quote | null {
	const row = getQuoteRow(handle, id);
	if (!row || row.status === "dropped") return null;
	return rowToQuote(row);
}

/** Includes Dropped rows; used to hydrate historic daily batches. */
export function getAnyQuoteById(handle: { sqlite: Database.Database }, id: number): Quote | null {
	const row = getQuoteRow(handle, id);
	return row ? rowToQuote(row) : null;
}

export function getQuoteRow(handle: { sqlite: Database.Database }, id: number): QuoteRow | null {
	const raw = handle.sqlite.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as
		| RawQuoteRow
		| undefined;
	return raw ? mapQuoteRow(raw) : null;
}

export function updateQuote(
	handle: { sqlite: Database.Database; db: Db },
	id: number,
	input: { text?: string; author?: string; status?: ActiveQuoteStatus },
): Quote {
	const existing = getQuoteRow(handle, id);
	if (!existing || existing.status === "dropped") throw notFound("Quote not found");

	const text = input.text?.trim() ?? existing.text;
	const author = input.author?.trim() ?? existing.author;
	const status = input.status ?? existing.status;
	const keys = quoteKeys(text, author);
	const updatedAt = nowIso();
	const textChanged = text !== existing.text || author !== existing.author;

	handle.sqlite.transaction(() => {
		handle.sqlite
			.prepare(
				`UPDATE quotes
				 SET text = ?, author = ?, status = ?, text_key = ?, author_key = ?, dedupe_key = ?, updated_at = ?
				 WHERE id = ?`,
			)
			.run(text, author, status, keys.textKey, keys.authorKey, keys.dedupeKey, updatedAt, id);
		if (textChanged) {
			ftsDelete(handle.sqlite, id);
			ftsInsert(handle.sqlite, id, text, author);
		}
	})();

	const updated = getQuoteById(handle, id);
	if (!updated) throw new Error("Failed to read quote after update");
	return updated;
}

/** Archive a quote into Dropped. Idempotent when it is already dropped. */
export function dropQuote(
	handle: { sqlite: Database.Database },
	id: number,
	source: DropSource,
): boolean {
	const existing = getQuoteRow(handle, id);
	if (!existing) throw notFound("Quote not found");
	if (existing.status === "dropped") return false;
	handle.sqlite.transaction(() => {
		handle.sqlite
			.prepare(
				`UPDATE quotes
				 SET status = 'dropped', dropped_at = ?, dropped_from = ?, drop_source = ?
				 WHERE id = ?`,
			)
			.run(nowIso(), existing.status, source, id);
		ftsDelete(handle.sqlite, id);
		handle.sqlite.prepare("DELETE FROM quote_embeddings WHERE quote_id = ?").run(id);
	})();
	return true;
}

export function dropQuotes(
	handle: { sqlite: Database.Database },
	ids: number[],
	source: ManualDropSource,
): number[] {
	const uniqueIds = [...new Set(ids)];
	if (uniqueIds.length === 0) return [];
	return handle.sqlite.transaction(() => {
		const dropped: number[] = [];
		for (const id of uniqueIds) {
			try {
				if (dropQuote(handle, id, source)) dropped.push(id);
			} catch {
				// Missing ids are ignored by bulk operations.
			}
		}
		return dropped;
	})();
}

/** Restore a Dropped quote into an active status. */
export function restoreQuote(
	handle: { sqlite: Database.Database },
	id: number,
	status: ActiveQuoteStatus,
): Quote {
	const existing = getQuoteRow(handle, id);
	if (!existing) throw notFound("Quote not found");
	if (existing.status !== "dropped") throw conflict("Quote is not dropped");
	const duplicate = handle.sqlite
		.prepare(
			"SELECT id FROM quotes WHERE dedupe_key = ? AND status != 'dropped' AND id != ? LIMIT 1",
		)
		.get(existing.dedupeKey, id) as { id: number } | undefined;
	if (duplicate) {
		throw conflict("An active quote with the same text and author already exists", {
			quoteId: duplicate.id,
		});
	}
	handle.sqlite.transaction(() => {
		handle.sqlite
			.prepare(
				"UPDATE quotes SET status = ?, dropped_at = NULL, dropped_from = NULL, drop_source = NULL, updated_at = ? WHERE id = ?",
			)
			.run(status, nowIso(), id);
		ftsInsert(handle.sqlite, id, existing.text, existing.author);
	})();
	const quote = getQuoteById(handle, id);
	if (!quote) throw new Error("Failed to read quote after restore");
	return quote;
}

/** Permanently remove a Dropped quote so its exact text becomes importable again. */
export function permanentlyDeleteQuote(handle: { sqlite: Database.Database }, id: number): void {
	const existing = getQuoteRow(handle, id);
	if (existing?.status !== "dropped") throw notFound("Dropped quote not found");
	handle.sqlite.transaction(() => {
		handle.sqlite.prepare("DELETE FROM quotes WHERE id = ?").run(id);
		ftsDelete(handle.sqlite, id);
	})();
}

export function listQuotes(
	handle: { sqlite: Database.Database },
	options: QuoteListOptions,
): QuoteListResponse {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
	const sort = options.sort ?? "newest";
	const filters = filterClause(options);
	const whereParts: string[] = [];
	const params: unknown[] = [];
	if (filters.sql) {
		whereParts.push(filters.sql.replace(/^WHERE /, ""));
		params.push(...filters.params);
	}

	const countRow = handle.sqlite
		.prepare(`SELECT COUNT(*) AS count FROM quotes q ${filters.sql}`)
		.get(...filters.params) as { count: number };
	const total = Number(countRow.count);

	let orderBy: string;
	if (sort === "newest") orderBy = "q.created_at DESC, q.id DESC";
	else if (sort === "oldest") orderBy = "q.created_at ASC, q.id ASC";
	else if (sort === "author") orderBy = "q.author_key ASC, q.id ASC";
	else orderBy = "q.last_sent_at IS NULL DESC, q.last_sent_at ASC, q.id ASC";

	let cursorClause = "";
	if (options.cursor) {
		if (sort === "newest" || sort === "oldest") {
			const cursor = decodeCursor<{ createdAt: string; id: number }>(options.cursor);
			const comparator = sort === "newest" ? "<" : ">";
			cursorClause = `(q.created_at ${comparator} ? OR (q.created_at = ? AND q.id ${comparator} ?))`;
			whereParts.push(cursorClause);
			params.push(cursor.createdAt, cursor.createdAt, cursor.id);
		} else if (sort === "author") {
			const cursor = decodeCursor<{ authorKey: string; id: number }>(options.cursor);
			cursorClause = "(q.author_key > ? OR (q.author_key = ? AND q.id > ?))";
			whereParts.push(cursorClause);
			params.push(cursor.authorKey, cursor.authorKey, cursor.id);
		} else {
			const cursor = decodeCursor<{ lastSentAt: string | null; id: number }>(options.cursor);
			if (cursor.lastSentAt === null) {
				cursorClause = "((q.last_sent_at IS NULL AND q.id > ?) OR q.last_sent_at IS NOT NULL)";
				params.push(cursor.id);
			} else {
				cursorClause = "(q.last_sent_at > ? OR (q.last_sent_at = ? AND q.id > ?))";
				params.push(cursor.lastSentAt, cursor.lastSentAt, cursor.id);
			}
			whereParts.push(cursorClause);
		}
	}

	const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
	const rawRows = handle.sqlite
		.prepare(`SELECT q.* FROM quotes q ${where} ORDER BY ${orderBy} LIMIT ?`)
		.all(...params, limit + 1) as RawQuoteRow[];
	const rows = rawRows.map(mapQuoteRow);

	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit).map(rowToQuote);
	let nextCursor: string | null = null;
	const last = rows[limit - 1];
	if (hasMore && last) {
		if (sort === "newest" || sort === "oldest") {
			nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
		} else if (sort === "author") {
			nextCursor = encodeCursor({ authorKey: last.authorKey, id: last.id });
		} else {
			nextCursor = encodeCursor({ lastSentAt: last.lastSentAt, id: last.id });
		}
	}

	return { items, nextCursor, total };
}

export function listDropped(
	handle: { sqlite: Database.Database },
	options: { q?: string; cursor?: string; limit?: number },
): QuoteListResponse {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
	const clauses = ["q.status = 'dropped'"];
	const params: unknown[] = [];
	if (options.q) {
		clauses.push("(q.text_key LIKE ? OR q.author_key LIKE ?)");
		const pattern = `%${normalizeTextKey(options.q)}%`;
		params.push(pattern, pattern);
	}
	if (options.cursor) {
		const cursor = decodeCursor<{ droppedAt: string; id: number }>(options.cursor);
		clauses.push("(q.dropped_at < ? OR (q.dropped_at = ? AND q.id < ?))");
		params.push(cursor.droppedAt, cursor.droppedAt, cursor.id);
	}
	const where = `WHERE ${clauses.join(" AND ")}`;
	const countParams: unknown[] = [];
	let countSql = "SELECT COUNT(*) AS count FROM quotes q WHERE q.status = 'dropped'";
	if (options.q) {
		countSql += " AND (q.text_key LIKE ? OR q.author_key LIKE ?)";
		const pattern = `%${normalizeTextKey(options.q)}%`;
		countParams.push(pattern, pattern);
	}
	const countRow = handle.sqlite.prepare(countSql).get(...countParams) as { count: number };
	const rows = handle.sqlite
		.prepare(`SELECT q.* FROM quotes q ${where} ORDER BY q.dropped_at DESC, q.id DESC LIMIT ?`)
		.all(...params, limit + 1) as RawQuoteRow[];
	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit).map((row) => rowToQuote(mapQuoteRow(row)));
	const last = rows[limit - 1];
	const nextCursor =
		hasMore && last?.dropped_at ? encodeCursor({ droppedAt: last.dropped_at, id: last.id }) : null;
	return { items, nextCursor, total: Number(countRow.count) };
}

export function statusCounts(handle: { sqlite: Database.Database }): Record<QuoteStatus, number> {
	const counts: Record<QuoteStatus, number> = {
		starred: 0,
		inbox: 0,
		private: 0,
		dropped: 0,
	};
	const rows = handle.sqlite
		.prepare("SELECT status, COUNT(*) AS count FROM quotes GROUP BY status")
		.all() as Array<{ status: QuoteStatus; count: number }>;
	for (const row of rows) {
		if (row.status in counts) counts[row.status] = Number(row.count);
	}
	return counts;
}

export function validateDateRange(from?: string, to?: string): void {
	if (from && Number.isNaN(new Date(from).getTime())) throw badRequest("Invalid 'from' date");
	if (to && Number.isNaN(new Date(to).getTime())) throw badRequest("Invalid 'to' date");
}

export function allQuoteIds(
	handle: { sqlite: Database.Database },
	filters?: QuoteFilters,
): number[] {
	const filtersSql = filters
		? filterClause(filters)
		: { sql: "WHERE q.status != 'dropped'", params: [] };
	const rows = handle.sqlite
		.prepare(`SELECT q.id FROM quotes q ${filtersSql.sql}`)
		.all(...filtersSql.params) as { id: number }[];
	return rows.map((row) => row.id);
}

export function getQuoteIdsByDedupe(
	handle: { sqlite: Database.Database },
	dedupeKey: string,
	excludeId?: number,
	options: { includeDropped?: boolean } = {},
): number[] {
	const rows = handle.sqlite
		.prepare(
			`SELECT id FROM quotes WHERE dedupe_key = ?
			 ${options.includeDropped ? "" : "AND status != 'dropped'"}
			 ${excludeId ? "AND id != ?" : ""} LIMIT 20`,
		)
		.all(...(excludeId ? [dedupeKey, excludeId] : [dedupeKey])) as { id: number }[];
	return rows.map((row) => row.id);
}

export function getQuoteIdsByTextKey(
	handle: { sqlite: Database.Database },
	textKey: string,
	excludeId?: number,
): number[] {
	const rows = handle.sqlite
		.prepare(
			`SELECT id FROM quotes WHERE text_key = ? AND status != 'dropped'
			 ${excludeId ? "AND id != ?" : ""} LIMIT 20`,
		)
		.all(...(excludeId ? [textKey, excludeId] : [textKey])) as { id: number }[];
	return rows.map((row) => row.id);
}

export function quoteByHashMaps(handle: { sqlite: Database.Database }) {
	const rows = handle.sqlite
		.prepare("SELECT id, dedupe_key, text_key FROM quotes WHERE status != 'dropped'")
		.all() as {
		id: number;
		dedupe_key: string;
		text_key: string;
	}[];
	const byDedupe = new Map<string, number[]>();
	const byText = new Map<string, number[]>();
	for (const row of rows) {
		const dedupe = byDedupe.get(row.dedupe_key) ?? [];
		dedupe.push(row.id);
		byDedupe.set(row.dedupe_key, dedupe);
		const text = byText.get(row.text_key) ?? [];
		text.push(row.id);
		byText.set(row.text_key, text);
	}
	return { byDedupe, byText };
}

export function updateQuoteKeys(
	handle: { sqlite: Database.Database },
	id: number,
	text: string,
	author: string,
): void {
	const keys = quoteKeys(text, author);
	handle.sqlite
		.prepare(
			"UPDATE quotes SET text_key = ?, author_key = ?, dedupe_key = ?, updated_at = ? WHERE id = ?",
		)
		.run(keys.textKey, keys.authorKey, keys.dedupeKey, nowIso(), id);
}

export function markQuoteSent(
	handle: { sqlite: Database.Database },
	id: number,
	sentAt: string,
): void {
	handle.sqlite
		.prepare("UPDATE quotes SET last_sent_at = ?, sent_count = sent_count + 1 WHERE id = ?")
		.run(sentAt, id);
}

export function setStatus(
	handle: { sqlite: Database.Database },
	id: number,
	status: ActiveQuoteStatus,
): void {
	const existing = getQuoteRow(handle, id);
	if (!existing || existing.status === "dropped") throw notFound("Quote not found");
	handle.sqlite
		.prepare("UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?")
		.run(status, nowIso(), id);
}

export function normalizeQuoteInput(text: string, author: string) {
	return {
		text: text.trim(),
		author: author.trim(),
		textKey: normalizeTextKey(text),
		authorKey: normalizeAuthorKey(author),
	};
}
