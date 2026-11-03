import type { FastifyServerOptions } from "fastify";
import type { AppConfig } from "../config.js";

export function loggerOptions(config: AppConfig): FastifyServerOptions["logger"] {
	return {
		level: config.logLevel,
		// Query strings can contain search text or filter values; keep them out of logs.
		serializers: {
			req: (request: unknown) => {
				const req = request as { method?: string; url?: string; host?: string; ip?: string };
				return {
					method: req.method,
					url: req.url?.split("?")[0],
					host: req.host,
					remoteAddress: req.ip,
				};
			},
			res: (reply: unknown) => ({ statusCode: (reply as { statusCode?: number }).statusCode }),
		},
		redact: {
			paths: [
				"req.headers.authorization",
				"req.headers.cookie",
				"req.headers['x-api-key']",
				"res.headers['set-cookie']",
			],
			censor: "[redacted]",
		},
	};
}
