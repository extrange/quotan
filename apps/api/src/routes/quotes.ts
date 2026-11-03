import {
	BulkDeleteQuotesSchema,
	CreateQuoteSchema,
	DuplicateCheckSchema,
	DuplicateIgnoreSchema,
	UpdateQuoteSchema,
} from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppConfig } from "../config.js";
import type { DatabaseHandle } from "../db/index.js";
import {
	createQuote,
	dropQuote,
	dropQuotes,
	getQuoteById,
	getQuoteRow,
	listQuotes,
	type QuoteFilters,
	updateQuote,
} from "../db/quotes.js";
import type { DuplicateService } from "../duplicates/service.js";
import type { EmbeddingService } from "../embeddings/service.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parseFilters, parseLimit, parseSort, queryValue } from "../lib/query.js";

export interface QuoteRouteDeps {
	handle: DatabaseHandle;
	config: AppConfig;
	embeddings: EmbeddingService;
	duplicates: DuplicateService;
}

function parseId(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw badRequest("Invalid quote id");
	return id;
}

function boundedInteger(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function registerQuoteRoutes(app: FastifyInstance, deps: QuoteRouteDeps): void {
	const server = app.withTypeProvider<ZodTypeProvider>();

	server.get("/api/quotes", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		const filters = parseFilters(query);
		const limit = parseLimit(queryValue(query, "limit"), 50);
		const cursor = queryValue(query, "cursor");
		const sort = parseSort(queryValue(query, "sort"));
		return listQuotes(deps.handle, { ...filters, limit, cursor, sort });
	});

	server.post("/api/quotes", { schema: { body: CreateQuoteSchema } }, async (request, reply) => {
		const status = request.body.status ?? (request.body.starred === true ? "starred" : "inbox");
		const quote = createQuote(deps.handle, {
			text: request.body.text,
			author: request.body.author,
			status,
		});
		const row = getQuoteRow(deps.handle, quote.id);
		if (row) await deps.embeddings.embedQuoteSync(row);
		return reply.code(201).send(quote);
	});

	server.get("/api/quotes/:id", async (request) => {
		const { id } = request.params as { id: string };
		const quote = getQuoteById(deps.handle, parseId(id));
		if (!quote) throw notFound("Quote not found");
		return quote;
	});

	server.patch("/api/quotes/:id", { schema: { body: UpdateQuoteSchema } }, async (request) => {
		const { id } = request.params as { id: string };
		const quoteId = parseId(id);
		const before = getQuoteRow(deps.handle, quoteId);
		if (!before) throw notFound("Quote not found");
		const status =
			request.body.status ??
			(request.body.starred === undefined ? undefined : request.body.starred ? "starred" : "inbox");
		const updated = updateQuote(deps.handle, quoteId, {
			text: request.body.text,
			author: request.body.author,
			status,
		});
		if (updated.text !== before.text) {
			deps.embeddings.removeQuoteVector(quoteId);
			const row = getQuoteRow(deps.handle, quoteId);
			if (row) await deps.embeddings.embedQuoteSync(row);
		}
		return updated;
	});

	server.delete("/api/quotes/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const quoteId = parseId(id);
		dropQuote(deps.handle, quoteId, "quote");
		deps.embeddings.removeQuoteVector(quoteId);
		return reply.code(204).send();
	});

	server.post(
		"/api/quotes/bulk-delete",
		{ schema: { body: BulkDeleteQuotesSchema } },
		async (request) => {
			const archivedIds = dropQuotes(deps.handle, request.body.ids, request.body.source);
			for (const id of archivedIds) deps.embeddings.removeQuoteVector(id);
			return { archived: archivedIds.length };
		},
	);

	server.get("/api/quotes/:id/similar", async (request) => {
		const { id } = request.params as { id: string };
		const query = request.query as Record<string, string | string[] | undefined>;
		const limit = parseLimit(queryValue(query, "limit"), 5);
		const quote = getQuoteById(deps.handle, parseId(id));
		if (!quote) throw notFound("Quote not found");
		return deps.duplicates.similarForQuote(quote.id, limit);
	});

	server.get("/api/duplicates", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		return deps.duplicates.scan({
			limit: boundedInteger(queryValue(query, "limit"), 50, 1, 200),
		});
	});

	server.post(
		"/api/duplicates/check",
		{ schema: { body: DuplicateCheckSchema } },
		async (request) => deps.duplicates.check(request.body),
	);

	server.post(
		"/api/duplicates/ignore",
		{ schema: { body: DuplicateIgnoreSchema } },
		async (request) => deps.duplicates.setIgnored(request.body.key, request.body.ignored),
	);
}

export function filtersFromQuery(
	query: Record<string, string | string[] | undefined>,
): QuoteFilters {
	return parseFilters(query);
}
