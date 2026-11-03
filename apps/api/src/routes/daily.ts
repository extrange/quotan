import { DailyCommitSchema } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { DailyService } from "../daily/service.js";
import { badRequest } from "../lib/errors.js";
import { parseBooleanValue, parseLimit, queryValue } from "../lib/query.js";

function validatedDate(value: string | undefined): string | undefined {
	if (value === undefined || value === "") return undefined;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest("Invalid date");
	return value;
}

export function registerDailyRoutes(app: FastifyInstance, daily: DailyService): void {
	const server = app.withTypeProvider<ZodTypeProvider>();

	server.get("/api/daily", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		const date = validatedDate(queryValue(query, "date"));
		return { batch: date ? daily.get(date) : daily.get() };
	});

	server.get("/api/daily/preview", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		return daily.preview(validatedDate(queryValue(query, "date")) ?? daily.today());
	});

	server.post("/api/daily", { schema: { body: DailyCommitSchema } }, async (request) =>
		daily.commit(request.body),
	);

	server.post("/api/daily/send", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		return daily.send(validatedDate(queryValue(query, "date")) ?? daily.today());
	});

	server.get("/api/deliveries", async (request) => {
		const query = request.query as Record<string, string | string[] | undefined>;
		return daily.listDeliveries({
			cursor: queryValue(query, "cursor"),
			limit: parseLimit(queryValue(query, "limit"), 50),
			channel: queryValue(query, "channel"),
			starred: parseBooleanValue(queryValue(query, "starred"), "starred"),
			from: queryValue(query, "from"),
			to: queryValue(query, "to"),
		});
	});
}
