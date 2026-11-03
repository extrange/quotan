import type { SearchQuery } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import { badRequest } from "../lib/errors.js";
import { parseFilters, parseLimit, queryValue } from "../lib/query.js";
import type { SearchService } from "../search/service.js";

export function registerSearchRoute(app: FastifyInstance, search: SearchService): void {
	app.get("/api/search", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		const q = queryValue(query, "q")?.trim();
		if (!q) throw badRequest("'q' is required");
		if (q.length > 500) throw badRequest("'q' is too long");
		const filters = parseFilters(query);
		const limit = parseLimit(queryValue(query, "limit"), 50);
		const input: SearchQuery = { q, ...filters, limit };
		return search.search(input);
	});
}
