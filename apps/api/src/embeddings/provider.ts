import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { env, type FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import type { EmbeddingConfig } from "../config.js";

export interface EmbeddingProvider {
	readonly name: "local" | "mock" | "none";
	readonly model: string;
	readonly dimensions: number;
	readonly available: boolean;
	embed(texts: string[]): Promise<Float32Array[]>;
	warmup?(): Promise<void>;
}

/**
 * ModernBERT's global attention mask grows quadratically with sequence length.
 * Isolating long inputs keeps a single long quote from padding an entire batch
 * to a sequence that ONNX Runtime cannot allocate.
 */
export const LONG_INPUT_ISOLATION_CHARS = 8000;

export function planEmbeddingBatches(
	texts: string[],
	batchSize: number,
	isolateAboveChars = LONG_INPUT_ISOLATION_CHARS,
): number[][] {
	const groups: number[][] = [];
	let current: number[] = [];
	const flush = () => {
		if (current.length > 0) groups.push(current);
		current = [];
	};
	for (let index = 0; index < texts.length; index += 1) {
		const length = texts[index]?.length ?? 0;
		if (length > isolateAboveChars) {
			flush();
			groups.push([index]);
			continue;
		}
		current.push(index);
		if (current.length >= Math.max(1, batchSize)) flush();
	}
	flush();
	return groups;
}

class LocalProvider implements EmbeddingProvider {
	readonly name = "local" as const;
	readonly model: string;
	readonly dimensions: number;
	readonly available = true;
	private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
	private inferenceQueue: Promise<void> = Promise.resolve();

	constructor(private readonly config: EmbeddingConfig) {
		this.model = config.model;
		this.dimensions = config.dimensions;
		const cacheDir = resolve(config.cacheDir);
		mkdirSync(cacheDir, { recursive: true });
		env.cacheDir = cacheDir;
		env.allowLocalModels = true;
		env.allowRemoteModels = config.allowRemoteModels;
	}

	private extractor(): Promise<FeatureExtractionPipeline> {
		if (!this.extractorPromise) {
			this.extractorPromise = pipeline("feature-extraction", this.model, {
				cache_dir: resolve(this.config.cacheDir),
				device: "cpu",
				dtype: this.config.dtype,
				local_files_only: !this.config.allowRemoteModels,
			}).catch((error: unknown) => {
				this.extractorPromise = null;
				throw error;
			});
		}
		return this.extractorPromise;
	}

	async warmup(): Promise<void> {
		await this.extractor();
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		if (texts.length === 0) return [];
		const previous = this.inferenceQueue;
		let release: () => void = () => {};
		this.inferenceQueue = new Promise<void>((resolveQueue) => {
			release = resolveQueue;
		});

		// Transformers.js is CPU-bound. Serialise calls so a background reindex
		// cannot run several ONNX batches at once alongside search or duplicates.
		await previous;
		try {
			const extractor = await this.extractor();
			const results = new Array<Float32Array>(texts.length);
			for (const group of planEmbeddingBatches(texts, this.config.batchSize)) {
				const output = await extractor(
					group.map((index) => texts[index] as string),
					{
						normalize: true,
						pooling: this.config.pooling,
					},
				);
				const values = output.tolist() as number[][] | number[];
				const rows = Array.isArray(values[0]) ? (values as number[][]) : [values as number[]];
				if (rows.length !== group.length) {
					throw new Error("Embedding provider returned the wrong number of vectors");
				}
				group.forEach((index, position) => {
					const row = rows[position];
					if (row) results[index] = Float32Array.from(row);
				});
			}
			return results;
		} finally {
			release();
		}
	}
}

class MockProvider implements EmbeddingProvider {
	readonly name = "mock" as const;
	readonly model = "quotan-mock";
	readonly dimensions: number;
	readonly available = true;

	constructor(config: EmbeddingConfig) {
		this.dimensions = config.dimensions;
	}

	async embed(texts: string[]): Promise<Float32Array[]> {
		return texts.map((text) => {
			const vector = new Float32Array(this.dimensions);
			let seed = createHash("sha256").update(text, "utf8").digest();
			for (let i = 0; i < this.dimensions; i += 1) {
				if (i > 0 && i % 32 === 0) {
					seed = createHash("sha256").update(seed).digest();
				}
				const byte = seed[i % 32] ?? 0;
				vector[i] = (byte / 255) * 2 - 1;
			}
			return vector;
		});
	}
}

class NoneProvider implements EmbeddingProvider {
	readonly name = "none" as const;
	readonly model = "none";
	readonly dimensions = 0;
	readonly available = false;

	async embed(): Promise<Float32Array[]> {
		throw new Error("Embedding provider is not configured");
	}
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
	switch (config.provider) {
		case "local":
			return new LocalProvider(config);
		case "mock":
			return new MockProvider(config);
		case "none":
			return new NoneProvider();
	}
}
