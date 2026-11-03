import { LoginRequestSchema } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppConfig } from "../config.js";
import { unauthorized } from "../lib/errors.js";
import { optionalAuth } from "./middleware.js";
import { type AuthService, SESSION_COOKIE } from "./service.js";

export function registerAuthRoutes(
	app: FastifyInstance,
	config: AppConfig,
	auth: AuthService,
): void {
	const deps = { config, auth };
	const server = app.withTypeProvider<ZodTypeProvider>();

	server.post(
		"/api/auth/login",
		{
			config: { rateLimit: { max: config.loginRateLimitMax, timeWindow: "1 minute" } },
			schema: { body: LoginRequestSchema },
		},
		async (request, reply) => {
			const { password } = request.body as { password: string };
			if (!auth.verifyPassword(password)) {
				throw unauthorized("Incorrect password");
			}
			const { token } = auth.createSession();
			reply.setCookie(SESSION_COOKIE, token, auth.cookieOptions());
			return { authenticated: true, label: config.authLabel, apiKeyConfigured: true };
		},
	);

	server.post("/api/auth/logout", { preHandler: optionalAuth(deps) }, async (request, reply) => {
		const token = request.cookies[SESSION_COOKIE];
		if (token) auth.deleteSession(token);
		reply.clearCookie(SESSION_COOKIE, auth.clearCookieOptions());
		return reply.code(204).send();
	});

	server.get("/api/auth/me", { preHandler: optionalAuth(deps) }, async (request) => {
		if (!request.auth) return { authenticated: false };
		return { authenticated: true, label: config.authLabel, apiKeyConfigured: true };
	});
}
