import { loadConfig } from "../apps/api/src/config.js";
import { createEmbeddingProvider } from "../apps/api/src/embeddings/provider.js";

async function main(): Promise<void> {
	// This is a setup helper, not a server boot: do not require production auth secrets.
	const config = loadConfig({ ...process.env, NODE_ENV: "development" });
	if (config.embedding.provider !== "local") {
		throw new Error(
			`EMBEDDING_PROVIDER is "${config.embedding.provider}"; set it to "local" to download a model.`,
		);
	}

	const provider = createEmbeddingProvider(config.embedding);
	if (!provider.warmup) throw new Error("The local provider does not support warmup");
	console.log(`Preparing ${provider.model} in ${config.embedding.cacheDir}...`);
	await provider.warmup();
	console.log("Embedding model is ready.");
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
