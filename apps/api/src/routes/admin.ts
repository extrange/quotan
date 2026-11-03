import type { FastifyInstance } from "fastify";
import { createBackup } from "../admin/backup.js";
import type { DatabaseHandle } from "../db/index.js";
import type { EmbeddingService } from "../embeddings/service.js";

export function registerAdminRoutes(
	app: FastifyInstance,
	handle: DatabaseHandle,
	embeddings: EmbeddingService,
): void {
	app.get("/api/admin/index/status", async () => embeddings.status());

	app.post("/api/admin/index/reindex", async (request, reply) => {
		const body = (request.body ?? {}) as { force?: unknown };
		const force = body.force === true;
		const status = embeddings.startReindex(force);
		return reply.code(202).send(status);
	});

	app.get("/api/admin/backup", async (_request, reply) => {
		const backup = await createBackup(handle.sqlite);
		return reply
			.header("Content-Type", "application/octet-stream")
			.header("Content-Disposition", `attachment; filename="${backup.filename}"`)
			.header("Content-Length", String(backup.buffer.byteLength))
			.send(backup.buffer);
	});
}
