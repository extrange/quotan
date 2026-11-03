import type { Stats } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { DailyService } from "../daily/service.js";
import type { EmbeddingService } from "../embeddings/service.js";

export function registerStatsRoute(
	app: FastifyInstance,
	daily: DailyService,
	embeddings: EmbeddingService,
): void {
	app.get(
		"/api/stats",
		async (): Promise<Stats> => ({
			...daily.stats(),
			index: embeddings.status(),
		}),
	);
}
