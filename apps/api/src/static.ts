import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";

function findWebDist(config: AppConfig): string | null {
	const candidates = [
		config.webDistPath ? resolve(config.webDistPath) : undefined,
		resolve(process.cwd(), "apps/web/dist"),
		resolve(process.cwd(), "../web/dist"),
		resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist"),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "index.html"))) return candidate;
	}
	return null;
}

export async function registerStatic(app: FastifyInstance, config: AppConfig): Promise<boolean> {
	const root = findWebDist(config);
	if (!root) {
		app.log.info("Web build not found; API-only mode");
		return false;
	}

	await app.register(fastifyStatic, {
		root,
		prefix: "/",
		wildcard: false,
		cacheControl: false,
		setHeaders: (response, path) => {
			if (path.endsWith("index.html")) {
				response.header("Cache-Control", "no-cache");
				return;
			}
			if (/\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|webp)$/i.test(path)) {
				response.header("Cache-Control", "public, max-age=31536000, immutable");
				return;
			}
			response.header("Cache-Control", "public, max-age=3600");
		},
	});

	const indexPath = join(root, "index.html");
	app.setNotFoundHandler(async (request, reply) => {
		if (request.url.startsWith("/api/")) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Route not found" },
			});
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Route not found" },
			});
		}
		const extension = extname(request.url.split("?")[0] ?? "");
		const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
		if (extension && !acceptsHtml) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Asset not found" },
			});
		}
		if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
			return reply.code(404).send({
				error: { code: "NOT_FOUND", message: "Web build not found" },
			});
		}
		return reply.sendFile("index.html", { maxAge: 0, cacheControl: false });
	});

	app.log.info({ root }, "Serving web build");
	return true;
}
