import type { Quote, SearchQuery, SearchResponse, SearchResult } from "@quotan/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseHandle } from "../db/index.js";
import {
	allQuoteIds,
	mapQuoteRow,
	type QuoteFilters,
	quoteFilterSql,
	rowToQuote,
} from "../db/quotes.js";
import type { EmbeddingService } from "../embeddings/service.js";
import { baseNormalize, ftsAndExpression, ftsOrExpression, queryTokens } from "../lib/normalize.js";

interface Ranked {
	id: number;
	keywordRank: number | null;
	vectorRank: number | null;
	similarity: number | null;
	score: number;
}

function hasFilters(filters: QuoteFilters): boolean {
	return (
		filters.status !== undefined ||
		filters.sent !== undefined ||
		Boolean(filters.author) ||
		Boolean(filters.from) ||
		Boolean(filters.to)
	);
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		timer.unref?.();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export class SearchService {
	constructor(
		private readonly handle: DatabaseHandle,
		private readonly config: AppConfig,
		private readonly embeddings: EmbeddingService,
		private readonly logger: FastifyBaseLogger,
	) {}

	async search(input: SearchQuery): Promise<SearchResponse> {
		const started = performance.now();
		const q = input.q.trim();
		const filters: QuoteFilters = {
			status:
				input.status ??
				(input.starred === undefined ? undefined : input.starred ? "starred" : "inbox"),
			sent: input.sent,
			author: input.author,
			from: input.from,
			to: input.to,
		};
		const allowedIds = hasFilters(filters) ? new Set(allQuoteIds(this.handle, filters)) : undefined;

		const tokens = queryTokens(q);
		const warnings: string[] = [];
		let keywordIds: number[] = [];
		if (tokens.length > 0) {
			keywordIds = this.keywordIds(tokens, filters, input.limit ?? 100);
			if (keywordIds.length === 0 && tokens.length > 1) {
				const orExpression = ftsOrExpression(tokens);
				if (orExpression) keywordIds = this.runFts(orExpression, filters, 100);
			}
		}

		let vectorResults: Array<{ id: number; score: number }> = [];
		let vectorUsed = false;
		if (this.embeddings.canVectorSearch) {
			try {
				const queryVector = await timeout(
					this.embeddings.embedQuery(q),
					10_000,
					"Query embedding timed out",
				);
				vectorResults = this.embeddings.store.search(
					queryVector,
					allowedIds,
					this.config.search.vectorCandidates,
				);
				vectorUsed = true;
			} catch (error) {
				this.logger.warn({ err: error }, "Semantic search unavailable");
				warnings.push("Semantic search is temporarily unavailable; showing keyword results.");
			}
		} else {
			warnings.push("Semantic search is unavailable; showing keyword results.");
		}

		const merged = new Map<number, Ranked>();
		const add = (id: number, patch: Partial<Ranked>) => {
			const current = merged.get(id) ?? {
				id,
				keywordRank: null,
				vectorRank: null,
				similarity: null,
				score: 0,
			};
			merged.set(id, { ...current, ...patch });
		};

		keywordIds.forEach((id, index) => {
			add(id, { keywordRank: index + 1 });
		});
		vectorResults.forEach((result, index) => {
			add(result.id, { vectorRank: index + 1, similarity: result.score });
		});

		const k = this.config.search.rrfK;
		for (const item of merged.values()) {
			if (item.keywordRank !== null) {
				item.score += this.config.search.keywordWeight / (k + item.keywordRank);
			}
			if (item.vectorRank !== null) {
				item.score += this.config.search.vectorWeight / (k + item.vectorRank);
			}
		}

		const ids = [...merged.keys()];
		const rows = this.rowsByIds(ids);
		const normalisedQuery = baseNormalize(q).toLowerCase();
		for (const row of rows.values()) {
			const item = merged.get(row.id);
			if (!item) continue;
			const text = baseNormalize(row.text).toLowerCase();
			const author = baseNormalize(row.author).toLowerCase();
			if (
				this.config.search.exactBoost > 0 &&
				normalisedQuery.length >= 3 &&
				(text.includes(normalisedQuery) || author.includes(normalisedQuery))
			) {
				item.score += this.config.search.exactBoost;
			}
		}

		const allResults: SearchResult[] = [...merged.values()]
			.map((item) => {
				const row = rows.get(item.id);
				if (!row) return null;
				const { textKey: _textKey, ...quote } = row;
				return {
					...quote,
					score: item.score,
					keywordRank: item.keywordRank,
					vectorRank: item.vectorRank,
					similarity: item.similarity,
				};
			})
			.filter((result): result is SearchResult => result !== null)
			.sort((a, b) => b.score - a.score || a.id - b.id);
		const filtered = allResults.filter(
			(result) =>
				result.keywordRank !== null || (result.similarity ?? 0) >= this.config.search.minSimilarity,
		);
		const results = filtered.slice(0, input.limit ?? 50);

		return {
			items: results,
			mode: vectorUsed ? "hybrid" : "keyword",
			total: filtered.length,
			tookMs: Math.round(performance.now() - started),
			...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
		};
	}

	private keywordIds(tokens: string[], filters: QuoteFilters, limit: number): number[] {
		const expression = ftsAndExpression(tokens);
		if (!expression) return [];
		return this.runFts(expression, filters, limit);
	}

	private runFts(expression: string, filters: QuoteFilters, limit: number): number[] {
		const clauses = ["quotes_fts MATCH ?"];
		const params: unknown[] = [expression];
		const filter = quoteFilterSql(filters);
		if (filter.sql) {
			clauses.push(filter.sql.replace(/^WHERE /, ""));
			params.push(...filter.params);
		}
		params.push(Math.min(Math.max(limit, 1), 200));
		try {
			const rows = this.handle.sqlite
				.prepare(
					`SELECT q.id
					 FROM quotes_fts
					 JOIN quotes q ON q.id = quotes_fts.rowid
					 WHERE ${clauses.join(" AND ")}
					   AND q.status != 'dropped'
					 ORDER BY bm25(quotes_fts, 1.0, 0.4)
					 LIMIT ?`,
				)
				.all(...params) as { id: number }[];
			return rows.map((row) => row.id);
		} catch (error) {
			this.logger.warn({ err: error }, "FTS search failed");
			return [];
		}
	}

	private rowsByIds(ids: number[]): Map<number, Quote & { textKey: string }> {
		const rows = new Map<number, Quote & { textKey: string }>();
		if (ids.length === 0) return rows;
		const placeholders = ids.map(() => "?").join(",");
		const records = this.handle.sqlite
			.prepare(`SELECT * FROM quotes WHERE id IN (${placeholders}) AND status != 'dropped'`)
			.all(...ids) as Array<Parameters<typeof mapQuoteRow>[0]>;
		for (const record of records) {
			const row = mapQuoteRow(record);
			rows.set(record.id, { ...rowToQuote(row), textKey: row.textKey });
		}
		return rows;
	}
}
