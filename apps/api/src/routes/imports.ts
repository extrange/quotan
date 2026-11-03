import { ImportCommitRequestSchema } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppConfig } from "../config.js";
import type { ImportService } from "../imports/service.js";
import { unprocessable } from "../lib/errors.js";

export function registerImportRoutes(
	app: FastifyInstance,
	config: AppConfig,
	importService: ImportService,
): void {
	const server = app.withTypeProvider<ZodTypeProvider>();

	server.post(
		"/api/import",
		{
			bodyLimit: config.import.bodyLimitBytes,
			schema: { body: ImportCommitRequestSchema },
		},
		async (request) => {
			if (request.body.rows.length > config.import.maxRows) {
				throw unprocessable(`Maximum ${config.import.maxRows} rows per import`);
			}
			return importService.commit(request.body);
		},
	);
}
