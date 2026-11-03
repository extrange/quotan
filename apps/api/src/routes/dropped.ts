import { RestoreQuoteSchema } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { DatabaseHandle } from "../db/index.js";
import { getQuoteRow, listDropped, permanentlyDeleteQuote, restoreQuote } from "../db/quotes.js";
import type { EmbeddingService } from "../embeddings/service.js";
import { badRequest } from "../lib/errors.js";
import { parseLimit, queryValue } from "../lib/query.js";

function parseId(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw badRequest("Invalid quote id");
	return id;
}

export function registerDroppedRoutes(
	app: FastifyInstance,
	handle: DatabaseHandle,
	embeddings: EmbeddingService,
): void {
	const server = app.withTypeProvider<ZodTypeProvider>();

	server.get("/api/dropped", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		return listDropped(handle, {
			q: queryValue(query, "q")?.trim() || undefined,
			cursor: queryValue(query, "cursor"),
			limit: parseLimit(queryValue(query, "limit"), 50),
		});
	});

	server.post(
		"/api/dropped/:id/restore",
		{ schema: { body: RestoreQuoteSchema } },
		async (request) => {
			const { id } = request.params as { id: string };
			const quote = restoreQuote(handle, parseId(id), request.body.status);
			const row = getQuoteRow(handle, quote.id);
			if (row) await embeddings.embedQuoteSync(row);
			return quote;
		},
	);

	server.delete("/api/dropped/:id", async (request, reply) => {
		const { id } = request.params as { id: string };
		const quoteId = parseId(id);
		permanentlyDeleteQuote(handle, quoteId);
		embeddings.removeQuoteVector(quoteId);
		return reply.code(204).send();
	});
}
