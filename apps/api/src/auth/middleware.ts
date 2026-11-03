import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { type AuthContext, type AuthService, SESSION_COOKIE } from "./service.js";

declare module "fastify" {
	interface FastifyRequest {
		auth: AuthContext | null;
	}
}

export interface AuthDeps {
	config: AppConfig;
	auth: AuthService;
}

function extractApiKey(request: FastifyRequest): string | undefined {
	const header = request.headers["x-api-key"];
	if (typeof header === "string" && header.trim()) return header.trim();
	const authorization = request.headers.authorization;
	if (authorization?.toLowerCase().startsWith("bearer ")) {
		return authorization.slice("Bearer ".length).trim();
	}
	return undefined;
}

export function authenticateRequest(
	request: FastifyRequest,
	{ auth }: AuthDeps,
): AuthContext | null {
	const apiKey = extractApiKey(request);
	if (auth.checkApiKey(apiKey)) return { method: "apiKey" };

	const token = request.cookies[SESSION_COOKIE];
	if (token && auth.getSession(token)) return { method: "session", token };
	return null;
}

export function requireAuth(deps: AuthDeps) {
	return async (request: FastifyRequest, _reply: FastifyReply) => {
		const context = authenticateRequest(request, deps);
		if (!context) throw unauthorized();
		request.auth = context;

		if (context.method === "session" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
			const origin = request.headers.origin;
			if (origin) {
				const allowed = new Set([deps.config.publicOrigin]);
				try {
					allowed.add(new URL(deps.config.publicOrigin).origin);
				} catch {
					// Config validation already ensured a URL.
				}
				// Behind a reverse proxy the browser's origin can differ from PUBLIC_ORIGIN
				// only by host spelling; trust the forwarded host as well.
				if (request.host) allowed.add(`${request.protocol}://${request.host}`);
				if (!deps.config.isProduction) {
					allowed.add("http://localhost:5173");
					allowed.add("http://127.0.0.1:5173");
				}
				if (!allowed.has(origin)) throw forbidden("Cross-origin request rejected");
			}
		}
	};
}

export function optionalAuth(deps: AuthDeps) {
	return async (request: FastifyRequest) => {
		request.auth = authenticateRequest(request, deps);
	};
}
