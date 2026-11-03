import type { FastifyInstance } from "fastify";
import type { ExportService } from "../export/service.js";
import { badRequest } from "../lib/errors.js";
import { parseBooleanValue, parseFilters, queryValue } from "../lib/query.js";
import { localDateString } from "../lib/time.js";

export function registerExportRoute(
	app: FastifyInstance,
	exportService: ExportService,
	timezone: string,
): void {
	app.get("/api/quotes/export", async (request, reply) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		const format = queryValue(query, "format") ?? "json";
		if (format !== "json" && format !== "csv") throw badRequest("Unsupported export format");
		const filters = parseFilters(query);
		const quotes = exportService.quotes(filters);
		const stamp = localDateString(new Date(), timezone);
		if (format === "csv") {
			const bom = parseBooleanValue(queryValue(query, "bom"), "bom") ?? false;
			reply
				.header("Content-Type", "text/csv; charset=utf-8")
				.header("Content-Disposition", `attachment; filename="quotan-${stamp}.csv"`)
				.send(exportService.csv(quotes, bom));
			return reply;
		}
		reply
			.header("Content-Type", "application/json; charset=utf-8")
			.header("Content-Disposition", `attachment; filename="quotan-${stamp}.json"`)
			.send(exportService.json(quotes));
		return reply;
	});
}
