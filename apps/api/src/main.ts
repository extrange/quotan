import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
	const config = loadConfig();
	for (const warning of config.warnings) {
		console.warn(`[config] ${warning}`);
	}
	const { app } = await buildApp(config);

	const shutdown = async (signal: string) => {
		app.log.info({ signal }, "Shutting down");
		try {
			await app.close();
		} finally {
			process.exit(0);
		}
	};
	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));

	try {
		await app.listen({ host: config.host, port: config.port });
	} catch (error) {
		app.log.error({ err: error }, "Failed to start server");
		await app.close();
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
