import type {
	DuplicateCategory,
	DuplicateCheckInput,
	DuplicateCheckResponse,
	DuplicateIgnoreResponse,
	DuplicateMatch,
	DuplicateScanResponse,
	Quote,
} from "@quotan/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import type { DatabaseHandle } from "../db/index.js";
import {
	getQuoteIdsByDedupe,
	getQuoteIdsByTextKey,
	getQuoteRow,
	listAllQuoteRows,
	rowToQuote,
} from "../db/quotes.js";
import type { QuoteRow } from "../db/schema.js";
import type { EmbeddingService } from "../embeddings/service.js";
import {
	dedupeKeyFor,
	ftsAndExpression,
	ftsOrExpression,
	normalizeAuthorKey,
	normalizeTextKey,
	queryTokens,
	trigramDice,
} from "../lib/normalize.js";
import { nowIso } from "../lib/time.js";
import { buildDuplicateGroups, DUPLICATE_SEVERITY, type DuplicateEdge } from "./cluster.js";

export interface DuplicateScanOptions {
	limit: number;
}

// Vectors in the in-memory store are normalised, so the dot product is cosine.
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0;
	let score = 0;
	for (let i = 0; i < a.length; i += 1) score += (a[i] ?? 0) * (b[i] ?? 0);
	return score;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Semantic duplicate check timed out")), ms);
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

export interface Classification {
	category: DuplicateCategory;
	trigram: number;
	similarity: number | null;
}

export function classifyDuplicate(
	input: { textKey: string; authorKey: string; dedupeKey: string },
	candidate: { textKey: string; authorKey: string; dedupeKey: string },
	similarity: number | null,
	config: AppConfig,
	trigram = trigramDice(input.textKey, candidate.textKey),
): Classification | null {
	if (input.dedupeKey === candidate.dedupeKey) {
		return { category: "exact", trigram, similarity };
	}
	if (input.textKey === candidate.textKey) {
		return { category: "same_text", trigram, similarity };
	}
	const likely =
		trigram >= config.search.trigramThreshold ||
		(similarity !== null && similarity >= config.search.likelyThreshold && trigram >= 0.4);
	if (likely) return { category: "likely", trigram, similarity };
	if (similarity !== null && similarity >= config.search.similarThreshold) {
		return { category: "similar", trigram, similarity };
	}
	return null;
}

export function ftsCandidateIds(
	handle: DatabaseHandle,
	text: string,
	limit: number,
	excludeId?: number,
): number[] {
	const tokens = queryTokens(text);
	if (tokens.length === 0) return [];
	const expressions = [ftsAndExpression(tokens), ftsOrExpression(tokens)].filter(
		(expression): expression is string => Boolean(expression),
	);
	const excludeClause = excludeId === undefined ? "" : " AND q.id != ?";
	for (const expression of expressions) {
		try {
			const params: Array<string | number> = [expression];
			if (excludeId !== undefined) params.push(excludeId);
			params.push(limit);
			const rows = handle.sqlite
				.prepare(
					`SELECT q.id
					 FROM quotes_fts
					 JOIN quotes q ON q.id = quotes_fts.rowid
					 WHERE quotes_fts MATCH ? AND q.status != 'dropped'${excludeClause}
					 ORDER BY bm25(quotes_fts, 1.0, 0.4)
					 LIMIT ?`,
				)
				.all(...params) as { id: number }[];
			if (rows.length > 0) return rows.map((row) => row.id);
		} catch {
			// Try the next expression.
		}
	}
	return [];
}

function quoteRowsByIds(handle: DatabaseHandle, ids: number[]) {
	const map = new Map<number, Quote>();
	for (const id of ids) {
		const row = getQuoteRow(handle, id);
		if (row && row.status !== "dropped") map.set(id, rowToQuote(row));
	}
	return map;
}

export class DuplicateService {
	constructor(
		private readonly handle: DatabaseHandle,
		private readonly config: AppConfig,
		private readonly embeddings: EmbeddingService,
		private readonly logger: FastifyBaseLogger,
	) {}

	scan(options: DuplicateScanOptions): DuplicateScanResponse {
		const rows = listAllQuoteRows(this.handle);
		const ignoredKeys = this.ignoredGroupKeys();
		const scanned = rows.length;
		const totalQuotes = scanned;
		const rowById = new Map(rows.map((row) => [row.id, row]));

		const byText = new Map<string, QuoteRow[]>();
		for (const row of rows) {
			const group = byText.get(row.textKey);
			if (group) group.push(row);
			else byText.set(row.textKey, [row]);
		}
		const textGroups = [...byText.values()].filter((textRows) => textRows.length >= 2);

		const vectorById = new Map<number, Float32Array>();
		if (this.embeddings.canVectorSearch) {
			for (const row of rows) {
				const vector = this.embeddings.store.get(row.id);
				if (vector) vectorById.set(row.id, vector);
			}
		}

		// Candidate generation keeps a large library from becoming O(n^2) trigram
		// comparisons. Vectors supply semantic neighbours; FTS supplements quotes
		// that have no vector yet (or all quotes when embeddings are unavailable).
		const candidatePairs: Array<{ left: QuoteRow; right: QuoteRow }> = [];
		const pairKeys = new Set<string>();
		const maxCandidatePairs = 25_000;
		let candidateLimitReached = false;
		const addCandidate = (leftId: number, rightId: number): void => {
			if (leftId === rightId || candidatePairs.length >= maxCandidatePairs) {
				if (candidatePairs.length >= maxCandidatePairs) candidateLimitReached = true;
				return;
			}
			const left = rowById.get(leftId);
			const right = rowById.get(rightId);
			if (!left || !right || left.textKey === right.textKey) return;
			const key = `${Math.min(left.id, right.id)}:${Math.max(left.id, right.id)}`;
			if (pairKeys.has(key)) return;
			pairKeys.add(key);
			// Normalise endpoint order so cluster keys and tie-breaks are deterministic.
			const first = left.id <= right.id ? left : right;
			const second = left.id <= right.id ? right : left;
			candidatePairs.push({ left: first, right: second });
		};

		for (const row of rows) {
			if (candidatePairs.length >= maxCandidatePairs) {
				candidateLimitReached = true;
				break;
			}
			const vector = vectorById.get(row.id);
			if (vector) {
				for (const result of this.embeddings.store.search(vector, undefined, 20)) {
					addCandidate(row.id, result.id);
				}
			}
			for (const id of ftsCandidateIds(this.handle, row.text, vector ? 10 : 20, row.id)) {
				addCandidate(row.id, id);
			}
		}

		const edges: DuplicateEdge[] = [];
		for (const { left, right } of candidatePairs) {
			const vector = vectorById.get(left.id);
			const otherVector = vectorById.get(right.id);
			const similarity = vector && otherVector ? cosineSimilarity(vector, otherVector) : null;
			const trigram = trigramDice(left.textKey, right.textKey);
			const classification = classifyDuplicate(left, right, similarity, this.config, trigram);
			if (
				!classification ||
				(classification.category !== "likely" && classification.category !== "similar")
			) {
				continue;
			}
			edges.push({
				left,
				right,
				category: classification.category,
				similarity,
				trigram,
			});
		}

		// Complete-linkage checks ask about pairs that were never candidate edges,
		// so resolve them from the in-memory vectors (or trigram when a quote has
		// no vector) and memoise the answer.
		const compatibilityCache = new Map<string, boolean>();
		const isPairCompatible = (left: QuoteRow, right: QuoteRow): boolean => {
			if (left.textKey === right.textKey) return true;
			const key = `${Math.min(left.id, right.id)}:${Math.max(left.id, right.id)}`;
			const cached = compatibilityCache.get(key);
			if (cached !== undefined) return cached;
			const leftVector = vectorById.get(left.id);
			const rightVector = vectorById.get(right.id);
			const compatible =
				leftVector && rightVector
					? cosineSimilarity(leftVector, rightVector) >= this.config.search.clusterSimilarity
					: trigramDice(left.textKey, right.textKey) >= this.config.search.clusterTrigram;
			compatibilityCache.set(key, compatible);
			return compatible;
		};

		const groups = buildDuplicateGroups({
			rowsById: rowById,
			textGroups,
			edges,
			config: this.config,
			isPairCompatible,
		});

		groups.sort(
			(a, b) =>
				DUPLICATE_SEVERITY[a.category] - DUPLICATE_SEVERITY[b.category] ||
				b.rows.length - a.rows.length ||
				(b.similarity ?? 0) - (a.similarity ?? 0) ||
				b.trigram - a.trigram ||
				a.key.localeCompare(b.key),
		);

		const warnings: string[] = [];
		const indexedQuotes = vectorById.size;
		if (scanned > 0 && indexedQuotes === 0) {
			warnings.push(
				"Semantic scan is unavailable; showing exact, different-author, and trigram matches.",
			);
		} else if (indexedQuotes < scanned) {
			warnings.push(
				`Semantic scan covered ${indexedQuotes} of ${scanned} scanned quotes; missing vectors may hide near matches.`,
			);
		}
		if (candidateLimitReached) {
			warnings.push("The duplicate candidate limit was reached; results may be incomplete.");
		}
		if (groups.length > options.limit) {
			warnings.push(`Showing the first ${options.limit} of ${groups.length} duplicate groups.`);
		}

		return {
			groups: groups.slice(0, options.limit).map(({ rows: groupRows, ...group }) => ({
				...group,
				ignored: ignoredKeys.has(group.key),
				quotes: groupRows.map(rowToQuote),
			})),
			totalGroups: groups.length,
			scanned,
			totalQuotes,
			embeddingUsed: indexedQuotes > 1,
			...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
		};
	}

	private ignoredGroupKeys(): Set<string> {
		const rows = this.handle.sqlite
			.prepare("SELECT group_key FROM duplicate_ignored_groups")
			.all() as Array<{ group_key: string }>;
		return new Set(rows.map((row) => row.group_key));
	}

	setIgnored(key: string, ignored: boolean): DuplicateIgnoreResponse {
		if (ignored) {
			this.handle.sqlite
				.prepare(
					"INSERT INTO duplicate_ignored_groups(group_key, created_at) VALUES(?, ?) ON CONFLICT(group_key) DO NOTHING",
				)
				.run(key, nowIso());
		} else {
			this.handle.sqlite
				.prepare("DELETE FROM duplicate_ignored_groups WHERE group_key = ?")
				.run(key);
		}
		return { key, ignored };
	}

	async check(input: DuplicateCheckInput): Promise<DuplicateCheckResponse> {
		const text = input.text.trim();
		const author = input.author?.trim() ?? "";
		const textKey = normalizeTextKey(text);
		const authorKey = normalizeAuthorKey(author);
		const dedupeKey = dedupeKeyFor(text, author);

		const exactIds = getQuoteIdsByDedupe(this.handle, dedupeKey, input.excludeId);
		const sameTextIds = getQuoteIdsByTextKey(this.handle, textKey, input.excludeId);
		const ftsIds = ftsCandidateIds(this.handle, text, 30, input.excludeId).filter(
			(id) => id !== input.excludeId,
		);

		let vectorScores = new Map<number, number>();
		let embeddingUsed = false;
		if (this.embeddings.canVectorSearch) {
			try {
				const [vector] = await withTimeout(this.embeddings.embedDocuments([text]), 6000);
				if (vector) {
					vectorScores = new Map(
						this.embeddings.store
							.search(vector, undefined, 30)
							.map((result) => [result.id, result.score]),
					);
					embeddingUsed = true;
				}
			} catch (error) {
				this.logger.warn({ err: error }, "Duplicate semantic check unavailable");
			}
		}

		const candidateIds = [
			...new Set([...exactIds, ...sameTextIds, ...ftsIds, ...vectorScores.keys()]),
		].filter((id) => id !== input.excludeId);
		const rows = quoteRowsByIds(this.handle, candidateIds);
		const matches: DuplicateMatch[] = [];

		for (const [id, quote] of rows) {
			const row = getQuoteRow(this.handle, id);
			if (!row) continue;
			const classification = classifyDuplicate(
				{ textKey, authorKey, dedupeKey },
				{
					textKey: row.textKey,
					authorKey: row.authorKey,
					dedupeKey: row.dedupeKey,
				},
				vectorScores.get(id) ?? null,
				this.config,
			);
			if (!classification) continue;
			matches.push({
				quote,
				category: classification.category,
				similarity: classification.similarity,
				trigram: classification.trigram,
			});
		}

		matches.sort(
			(a, b) =>
				DUPLICATE_SEVERITY[a.category] - DUPLICATE_SEVERITY[b.category] ||
				(b.similarity ?? 0) - (a.similarity ?? 0) ||
				b.trigram - a.trigram,
		);
		const top = matches.slice(0, 5);
		return {
			verdict: top[0]?.category ?? "none",
			matches: top,
			embeddingUsed,
		};
	}

	similarForQuote(id: number, limit: number): DuplicateMatch[] {
		const row = getQuoteRow(this.handle, id);
		if (!row) return [];
		const vector = this.embeddings.store.get(id);
		if (!vector) return [];
		const results = this.embeddings.store.search(
			vector,
			undefined,
			Math.min(Math.max(limit * 3, limit), 50),
		);
		const matches: DuplicateMatch[] = [];
		for (const result of results) {
			if (result.id === id) continue;
			const candidate = getQuoteRow(this.handle, result.id);
			if (!candidate) continue;
			const trigram = trigramDice(row.textKey, candidate.textKey);
			const likely =
				trigram >= this.config.search.trigramThreshold ||
				(result.score >= this.config.search.likelyThreshold && trigram >= 0.4);
			const category: DuplicateCategory | null = likely
				? "likely"
				: result.score >= this.config.search.similarThreshold
					? "similar"
					: null;
			if (!category) continue;
			matches.push({
				quote: rowToQuote(candidate),
				category,
				similarity: result.score,
				trigram,
			});
			if (matches.length >= limit) break;
		}
		return matches;
	}
}
