import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { requireAuth } from "./auth/middleware.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import type { AppConfig } from "./config.js";
import { DailyScheduler } from "./daily/scheduler.js";
import { DailyService } from "./daily/service.js";
import { openDatabase } from "./db/index.js";
import { DuplicateService } from "./duplicates/service.js";
import { EmbeddingService } from "./embeddings/service.js";
import { ExportService } from "./export/service.js";
import { ImportService } from "./imports/service.js";
import { ApiError } from "./lib/errors.js";
import { loggerOptions } from "./lib/logger.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDailyRoutes } from "./routes/daily.js";
import { registerDroppedRoutes } from "./routes/dropped.js";
import { registerExportRoute } from "./routes/export.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerQuoteRoutes } from "./routes/quotes.js";
import { registerSearchRoute } from "./routes/search.js";
import { registerSettingsRoute } from "./routes/settings.js";
import { registerStatsRoute } from "./routes/stats.js";
import { SearchService } from "./search/service.js";
import { registerStatic } from "./static.js";
import { TelegramService } from "./telegram/service.js";

export async function buildApp(config: AppConfig, options: { startScheduler?: boolean } = {}) {
	const fastify = Fastify({
		logger: loggerOptions(config),
		trustProxy: config.trustProxy,
		bodyLimit: 2 * 1024 * 1024,
		requestTimeout: 30_000,
	});
	fastify.setValidatorCompiler(validatorCompiler);
	fastify.setSerializerCompiler(serializerCompiler);
	const app = fastify.withTypeProvider<ZodTypeProvider>();
	app.decorateRequest("auth", null);

	await app.register(cookie);
	await app.register(helmet, {
		contentSecurityPolicy: false,
		crossOriginEmbedderPolicy: false,
	});
	await app.register(compress);
	await app.register(rateLimit, {
		max: config.rateLimitMax,
		timeWindow: "1 minute",
		allowList: [],
	});
	if (config.corsOrigins.length > 0) {
		await app.register(cors, {
			origin: config.corsOrigins,
			credentials: true,
		});
	}
	await app.register(swagger, {
		openapi: {
			info: {
				title: "Quotan API",
				description: "Single-user quote manager API",
				version: "0.1.0",
			},
			components: {
				securitySchemes: {
					apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
					bearer: { type: "http", scheme: "bearer" },
					session: { type: "apiKey", in: "cookie", name: "quotan_session" },
				},
			},
		},
		transform: jsonSchemaTransform,
	});

	const handle = openDatabase(config.databasePath);
	const auth = new AuthService(config, handle.sqlite);
	const embeddings = new EmbeddingService(handle, config, app.log);
	const duplicates = new DuplicateService(handle, config, embeddings, app.log);
	const search = new SearchService(handle, config, embeddings, app.log);
	const telegram = new TelegramService(config.telegram);
	const daily = new DailyService(handle, config, telegram, embeddings);
	const scheduler = new DailyScheduler(daily, config, app.log);
	const importService = new ImportService(handle, config, embeddings);
	const exportService = new ExportService(handle);

	await embeddings.init();
	auth.cleanupExpired();
	const cleanupTimer = setInterval(() => auth.cleanupExpired(), 3_600_000);
	cleanupTimer.unref?.();

	registerHealthRoute(app, handle);
	registerAuthRoutes(app, config, auth);

	await app.register(async (protectedApp) => {
		protectedApp.addHook("preHandler", requireAuth({ config, auth }));
		registerQuoteRoutes(protectedApp, { handle, config, embeddings, duplicates });
		registerSearchRoute(protectedApp, search);
		registerDailyRoutes(protectedApp, daily);
		registerDroppedRoutes(protectedApp, handle, embeddings);
		registerSettingsRoute(protectedApp, config);
		registerStatsRoute(protectedApp, daily, embeddings);
		registerImportRoutes(protectedApp, config, importService);
		registerExportRoute(protectedApp, exportService, config.appTimezone);
		registerAdminRoutes(protectedApp, handle, embeddings);
	});

	if (config.docsEnabled) {
		app.get("/api/openapi.json", async () => app.swagger());
		await app.register(swaggerUi, {
			routePrefix: "/api/docs",
			uiConfig: { url: "/api/openapi.json" },
			staticCSP: false,
		});
	}

	if (options.startScheduler !== false) scheduler.start();

	const hasStatic = await registerStatic(app, config);
	if (!hasStatic) {
		app.setNotFoundHandler(async (request, reply) => {
			if (request.url.startsWith("/api/")) {
				return reply.code(404).send({
					error: { code: "NOT_FOUND", message: "Route not found" },
				});
			}
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Web build not found" },
			});
		});
	}

	app.setErrorHandler((error, request, reply) => {
		if (error instanceof ApiError) {
			return reply.code(error.statusCode).send({
				error: {
					code: error.code,
					message: error.message,
					...(error.details !== undefined ? { details: error.details } : {}),
				},
			});
		}
		const validation = (error as { validation?: unknown }).validation;
		if (validation) {
			return reply.code(422).send({
				error: {
					code: "VALIDATION_ERROR",
					message: "Request validation failed",
					details: validation,
				},
			});
		}
		const code = (error as { code?: string }).code;
		if (code?.startsWith("SQLITE_CONSTRAINT")) {
			return reply.code(409).send({
				error: { code: "CONFLICT", message: "The request conflicts with existing data" },
			});
		}
		request.log.error({ err: error }, "Unhandled request error");
		return reply.code(500).send({
			error: { code: "INTERNAL_ERROR", message: "Internal server error" },
		});
	});

	app.addHook("onClose", async () => {
		scheduler.stop();
		clearInterval(cleanupTimer);
		embeddings.close();
		handle.close();
	});

	return { app, handle, embeddings, auth, daily, scheduler };
}
