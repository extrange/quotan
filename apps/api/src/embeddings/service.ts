import type { IndexStatus } from "@quotan/shared";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import { type DatabaseHandle, getMeta, setMeta } from "../db/index.js";
import { LruCache } from "../lib/lru.js";
import { hashString } from "../lib/normalize.js";
import { nowIso } from "../lib/time.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./provider.js";
import { bufferToVector, normalizeVector, VectorStore, vectorToBuffer } from "./vector.js";

interface QuoteForEmbedding {
	id: number;
	text: string;
	textKey: string;
}

interface StatusFields {
	state: IndexStatus["state"];
	processed: number;
	startedAt: string | null;
	finishedAt: string | null;
	error: string | null;
}

export class EmbeddingService {
	readonly provider: EmbeddingProvider;
	readonly store: VectorStore;
	readonly modelKey: string;
	private readonly queryCache = new LruCache<Float32Array>(256, 60 * 60 * 1000);
	private readonly statusFields: StatusFields = {
		state: "stale",
		processed: 0,
		startedAt: null,
		finishedAt: null,
		error: null,
	};
	private activeModelKey: string | null = null;
	private activeDims = 0;
	private timer: NodeJS.Timeout | null = null;
	private reindexing = false;
	private filling = false;
	private idlePromise: Promise<void> = Promise.resolve();

	constructor(
		private readonly handle: DatabaseHandle,
		private readonly config: AppConfig,
		private readonly logger: FastifyBaseLogger,
	) {
		this.provider = createEmbeddingProvider(config.embedding);
		const settingsHash = hashString(
			[
				config.embedding.documentPrefix,
				config.embedding.queryPrefix,
				config.embedding.dtype,
				config.embedding.pooling,
			].join("\u001f"),
		).slice(0, 8);
		this.modelKey = `${this.provider.name}:${this.provider.model}:${this.provider.dimensions}:${settingsHash}`;
		this.activeModelKey = getMeta(handle.sqlite, "active_model_key");
		this.activeDims = Number(getMeta(handle.sqlite, "active_dims") ?? 0);
		this.store = new VectorStore(this.provider.dimensions || this.activeDims || 0, null);
	}

	get sqlite(): Database.Database {
		return this.handle.sqlite;
	}

	get totalQuotes(): number {
		const row = this.sqlite
			.prepare("SELECT COUNT(*) AS count FROM quotes WHERE status != 'dropped'")
			.get() as {
			count: number;
		};
		return Number(row.count);
	}

	get canVectorSearch(): boolean {
		if (!this.provider.available || this.store.size === 0) return false;
		if (this.statusFields.state === "ready") return true;
		return this.statusFields.state === "indexing" && this.activeModelKey === this.modelKey;
	}

	async init(): Promise<void> {
		const total = this.totalQuotes;
		if (!this.provider.available) {
			this.statusFields.state = "disabled";
			this.statusFields.error = "Embedding provider is not configured";
			this.startWorker();
			return;
		}

		if (this.provider.warmup) {
			void this.provider.warmup().catch((error: unknown) => {
				this.logger.warn({ err: error }, "Failed to warm up the embedding model");
			});
		}

		if (this.activeModelKey === this.modelKey) {
			this.loadStore(this.modelKey);
			this.statusFields.state = "ready";
			this.statusFields.finishedAt = nowIso();
			this.kick();
		} else if (total === 0) {
			this.activeModelKey = this.modelKey;
			this.activeDims = this.provider.dimensions;
			setMeta(this.sqlite, "active_model_key", this.modelKey);
			setMeta(this.sqlite, "active_dims", String(this.provider.dimensions));
			this.statusFields.state = "ready";
		} else if (this.config.embedding.autoReindex) {
			this.startReindex(false);
		} else {
			this.statusFields.state = "stale";
			this.statusFields.error = "Embedding model changed; run a reindex";
		}

		this.startWorker();
	}

	start(): void {
		void this.init().catch((error: unknown) => {
			this.logger.error({ err: error }, "Failed to initialise embedding service");
			this.statusFields.state = "error";
			this.statusFields.error = error instanceof Error ? error.message : "Unknown error";
		});
	}

	status(): IndexStatus {
		const total = this.totalQuotes;
		const indexedRow = this.sqlite
			.prepare(
				`SELECT COUNT(*) AS count
				 FROM quote_embeddings e
				 JOIN quotes q ON q.id = e.quote_id
				 WHERE e.model_key = ? AND e.text_key = q.text_key AND q.status != 'dropped'`,
			)
			.get(this.modelKey) as { count: number };
		const indexed = Number(indexedRow.count);
		return {
			provider: this.provider.name,
			model: this.provider.model,
			modelKey: this.modelKey,
			dimensions: this.provider.dimensions,
			state: this.statusFields.state,
			total,
			indexed,
			pending: Math.max(0, total - indexed),
			processed: this.statusFields.processed,
			error: this.statusFields.error,
			startedAt: this.statusFields.startedAt,
			finishedAt: this.statusFields.finishedAt,
		};
	}

	startReindex(force: boolean): IndexStatus {
		if (this.reindexing) return this.status();
		if (!this.provider.available) {
			this.statusFields.state = "disabled";
			this.statusFields.error = "Embedding provider is not configured";
			return this.status();
		}
		this.reindexing = true;
		const total = this.totalQuotes;
		this.statusFields.state = "indexing";
		this.statusFields.processed = 0;
		this.statusFields.startedAt = nowIso();
		this.statusFields.finishedAt = null;
		this.statusFields.error = null;
		this.idlePromise = this.runReindex(force, total)
			.catch((error: unknown) => {
				this.logger.error({ err: error }, "Embedding reindex failed");
				this.statusFields.state = "error";
				this.statusFields.error = error instanceof Error ? error.message : "Unknown error";
				this.statusFields.finishedAt = nowIso();
			})
			.finally(() => {
				this.reindexing = false;
			});
		return this.status();
	}

	private async runReindex(force: boolean, total: number): Promise<void> {
		const modelChanged = this.activeModelKey !== this.modelKey;
		const ids =
			force || modelChanged
				? (
						this.sqlite
							.prepare("SELECT id FROM quotes WHERE status != 'dropped' ORDER BY id")
							.all() as { id: number }[]
					).map((row) => row.id)
				: this.missingIds(100_000);

		await this.embedIds(ids, total);

		for (let pass = 0; pass < 3; pass += 1) {
			const missing = this.missingIds(200);
			if (missing.length === 0) break;
			await this.embedIds(missing, total);
		}

		this.sqlite.prepare("DELETE FROM quote_embeddings WHERE model_key != ?").run(this.modelKey);
		this.activeModelKey = this.modelKey;
		this.activeDims = this.provider.dimensions;
		setMeta(this.sqlite, "active_model_key", this.modelKey);
		setMeta(this.sqlite, "active_dims", String(this.provider.dimensions));
		this.loadStore(this.modelKey);
		this.statusFields.state = "ready";
		this.statusFields.processed = total;
		this.statusFields.finishedAt = nowIso();
		this.logger.info({ model: this.modelKey, total }, "Embedding index is ready");
		this.kick();
	}

	private async embedIds(ids: number[], total: number): Promise<void> {
		const batchSize = this.config.embedding.batchSize;
		for (let offset = 0; offset < ids.length; offset += batchSize) {
			const batchIds = ids.slice(offset, offset + batchSize);
			const rows = this.sqlite
				.prepare(
					`SELECT id, text, text_key AS textKey FROM quotes
					 WHERE id IN (${batchIds.map(() => "?").join(",")}) AND status != 'dropped'`,
				)
				.all(...batchIds) as QuoteForEmbedding[];
			if (rows.length === 0) continue;
			const vectors = await this.embedWithRetry(rows.map((row) => this.documentText(row.text)));
			this.sqlite.transaction(() => {
				for (let i = 0; i < rows.length; i += 1) {
					const row = rows[i];
					const vector = vectors[i];
					if (!row || !vector) continue;
					this.storeVector(row.id, row.textKey, vector, this.modelKey);
				}
			})();
			this.statusFields.processed = Math.min(total, this.statusFields.processed + rows.length);
		}
	}

	private missingIds(limit: number): number[] {
		const rows = this.sqlite
			.prepare(
				`SELECT q.id
				 FROM quotes q
				 LEFT JOIN quote_embeddings e
				   ON e.quote_id = q.id AND e.model_key = ?
				 WHERE q.status != 'dropped'
				   AND (e.quote_id IS NULL OR e.text_key != q.text_key)
				 ORDER BY q.id
				 LIMIT ?`,
			)
			.all(this.modelKey, limit) as { id: number }[];
		return rows.map((row) => row.id);
	}

	private loadStore(modelKey: string): void {
		const rows = this.sqlite
			.prepare(
				`SELECT e.quote_id AS id, e.vector, e.dims
				 FROM quote_embeddings e
				 JOIN quotes q ON q.id = e.quote_id
				 WHERE e.model_key = ? AND e.text_key = q.text_key AND q.status != 'dropped'`,
			)
			.all(modelKey) as { id: number; vector: Buffer; dims: number }[];
		this.store.modelKey = modelKey;
		this.store.load(
			rows
				.filter((row) => row.dims === this.provider.dimensions)
				.map((row) => ({ id: row.id, vector: bufferToVector(row.vector) })),
		);
		this.logger.info({ modelKey, vectors: this.store.size }, "Loaded vector index");
	}

	private documentText(text: string): string {
		return `${this.config.embedding.documentPrefix}${text}`.slice(
			0,
			this.config.embedding.maxChars,
		);
	}

	private queryText(text: string): string {
		return `${this.config.embedding.queryPrefix}${text}`.slice(0, this.config.embedding.maxChars);
	}

	private async embedWithRetry(texts: string[]): Promise<Float32Array[]> {
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const vectors = await this.provider.embed(texts);
				if (vectors.length !== texts.length) {
					throw new Error("Embedding provider returned the wrong number of vectors");
				}
				for (const vector of vectors) {
					if (this.provider.dimensions > 0 && vector.length !== this.provider.dimensions) {
						throw new Error(
							`Embedding dimension mismatch: expected ${this.provider.dimensions}, received ${vector.length}`,
						);
					}
				}
				return vectors.map(normalizeVector);
			} catch (error) {
				lastError = error;
				await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
			}
		}
		throw lastError instanceof Error ? lastError : new Error("Embedding request failed");
	}

	private storeVector(
		quoteId: number,
		textKey: string,
		vector: Float32Array,
		modelKey: string,
	): void {
		this.sqlite
			.prepare(
				`INSERT INTO quote_embeddings(quote_id, model_key, text_key, dims, vector, created_at)
				 VALUES(?, ?, ?, ?, ?, ?)
				 ON CONFLICT(quote_id, model_key) DO UPDATE SET
				   text_key = excluded.text_key,
				   dims = excluded.dims,
				   vector = excluded.vector,
				   created_at = excluded.created_at`,
			)
			.run(quoteId, modelKey, textKey, this.provider.dimensions, vectorToBuffer(vector), nowIso());
		if (modelKey === this.activeModelKey) this.store.upsert(quoteId, vector);
	}

	async embedDocuments(texts: string[]): Promise<Float32Array[]> {
		const out: Float32Array[] = [];
		for (let offset = 0; offset < texts.length; offset += this.config.embedding.batchSize) {
			const batch = texts.slice(offset, offset + this.config.embedding.batchSize);
			out.push(...(await this.embedWithRetry(batch.map((text) => this.documentText(text)))));
		}
		return out;
	}

	async embedQuery(query: string): Promise<Float32Array> {
		const cacheKey = `${this.modelKey}\u001f${query}`;
		const cached = this.queryCache.get(cacheKey);
		if (cached) return cached;
		const [vector] = await this.embedWithRetry([this.queryText(query)]);
		if (!vector) throw new Error("Embedding provider returned no vector");
		this.queryCache.set(cacheKey, vector);
		return vector;
	}

	async embedQuoteSync(quote: { id: number; text: string; textKey: string }): Promise<boolean> {
		if (!this.provider.available) return false;
		try {
			const [vector] = await Promise.race([
				this.embedWithRetry([this.documentText(quote.text)]),
				new Promise<never>((_resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error("Synchronous embedding timed out")),
						8000,
					);
					timer.unref?.();
				}),
			]);
			if (!vector) return false;
			this.sqlite
				.prepare(
					`INSERT INTO quote_embeddings(quote_id, model_key, text_key, dims, vector, created_at)
					 VALUES(?, ?, ?, ?, ?, ?)
					 ON CONFLICT(quote_id, model_key) DO UPDATE SET
					   text_key = excluded.text_key,
					   dims = excluded.dims,
					   vector = excluded.vector,
					   created_at = excluded.created_at`,
				)
				.run(
					quote.id,
					this.modelKey,
					quote.textKey,
					this.provider.dimensions,
					vectorToBuffer(vector),
					nowIso(),
				);
			if (this.activeModelKey === this.modelKey) this.store.upsert(quote.id, vector);
			return true;
		} catch (error) {
			this.logger.warn({ err: error, quoteId: quote.id }, "Failed to embed quote");
			return false;
		}
	}

	removeQuoteVector(quoteId: number): void {
		this.sqlite.prepare("DELETE FROM quote_embeddings WHERE quote_id = ?").run(quoteId);
		this.store.remove(quoteId);
	}

	kick(): void {
		if (this.filling || this.reindexing || this.statusFields.state !== "ready") return;
		if (!this.provider.available) return;
		const first = this.missingIds(this.config.embedding.batchSize);
		if (first.length === 0) return;
		this.filling = true;
		void (async () => {
			let ids = first;
			while (ids.length > 0 && this.statusFields.state === "ready") {
				await this.embedIds(ids, this.totalQuotes);
				ids = this.missingIds(this.config.embedding.batchSize);
			}
		})()
			.catch((error: unknown) => {
				this.logger.warn({ err: error }, "Background embedding pass failed");
			})
			.finally(() => {
				this.filling = false;
			});
	}

	private startWorker(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.kick(), this.config.embedding.retryIntervalMs);
		this.timer.unref?.();
	}

	async waitForIdle(): Promise<void> {
		await this.idlePromise;
		if (this.filling) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			await this.waitForIdle();
		}
	}

	close(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}
