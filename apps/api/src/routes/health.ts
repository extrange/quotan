import type { FastifyInstance } from "fastify";
import type { DatabaseHandle } from "../db/index.js";

export const APP_VERSION = "0.1.0";

export function registerHealthRoute(app: FastifyInstance, handle: DatabaseHandle): void {
	app.get("/api/healthz", async (_request, reply) => {
		try {
			handle.sqlite.prepare("SELECT 1").get();
			return { status: "ok", db: "ok", version: APP_VERSION };
		} catch {
			return reply.code(503).send({ status: "error", db: "error" });
		}
	});
}
