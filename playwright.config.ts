import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		...(executablePath ? { launchOptions: { executablePath } } : {}),
		...devices["Desktop Chrome"],
	},
	webServer: {
		command: [
			"rm -f data/e2e.sqlite data/e2e.sqlite-shm data/e2e.sqlite-wal",
			"&&",
			`PORT=${port}`,
			`HOST=127.0.0.1`,
			`DATABASE_PATH=./data/e2e.sqlite`,
			`AUTH_PASSWORD=quotan`,
			`API_KEY=e2e-api-key-0123456789`,
			`PUBLIC_ORIGIN=http://127.0.0.1:${port}`,
			`EMBEDDING_PROVIDER=mock`,
			`EMBEDDING_DIMENSIONS=64`,
			`AUTO_REINDEX=true`,
			`DOCS_ENABLED=false`,
			`LOG_LEVEL=silent`,
			`RATE_LIMIT_MAX=10000`,
			`LOGIN_RATE_LIMIT_MAX=1000`,
			`WEB_DIST_PATH=apps/web/dist`,
			"node apps/api/dist/main.js",
		].join(" "),
		url: `http://127.0.0.1:${port}/api/healthz`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
