import { APP_VERSION } from "@quotan/shared";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

export function registerSettingsRoute(app: FastifyInstance, config: AppConfig): void {
	app.get("/api/settings", async () => ({
		telegram: {
			enabled: config.telegram.enabled,
			configured: config.telegram.configured,
			chatIdMasked: config.telegram.chatIdMasked,
			sendTime: config.telegram.sendTime,
			timezone: config.telegram.timezone,
		},
		version: APP_VERSION,
	}));
}
