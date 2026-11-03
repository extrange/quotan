import { createHash, randomUUID } from "node:crypto";
import type {
	DailyBatch,
	DailySendState,
	Delivery,
	DeliveryListResponse,
	Quote,
} from "@quotan/shared";
import type { AppConfig } from "../config.js";
import type { DatabaseHandle } from "../db/index.js";
import { ftsDelete } from "../db/index.js";
import { getQuoteRow, mapQuoteRow, rowToQuote, statusCounts } from "../db/quotes.js";
import type { EmbeddingService } from "../embeddings/service.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { badRequest } from "../lib/errors.js";
import { localDateString } from "../lib/time.js";
import { formatDailyMessage, type TelegramService } from "../telegram/service.js";

interface DailyBatchRecord {
	id: string;
	local_date: string;
	starred_quote_id: number | null;
	unstarred_quote_id: number | null;
	channel: string;
	created_at: string;
	send_state: DailySendState;
	sent_at: string | null;
	telegram_message_id: number | null;
	attempts: number;
	last_attempt_at: string | null;
	last_error: string | null;
}

interface DeliveryRecord {
	id: number;
	batch_id: string;
	quote_id: number | null;
	quote_text: string;
	quote_author: string;
	starred_snapshot: number;
	channel: string;
	sent_at: string;
}

export interface DailySendResult {
	batch: DailyBatch | null;
	alreadySent: boolean;
}

function previousDate(date: string): string {
	const parsed = new Date(`${date}T12:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() - 1);
	return parsed.toISOString().slice(0, 10);
}

function dateRange(count: number, today: string): string[] {
	const days: string[] = [];
	let cursor = today;
	for (let i = 0; i < count; i += 1) {
		days.unshift(cursor);
		cursor = previousDate(cursor);
	}
	return days;
}

function monthKeys(count: number, today: string): string[] {
	const keys: string[] = [];
	const cursor = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
	for (let i = count - 1; i >= 0; i -= 1) {
		const month = new Date(cursor);
		month.setUTCMonth(month.getUTCMonth() - i);
		keys.push(month.toISOString().slice(0, 7));
	}
	return keys;
}

export class DailyService {
	private readonly inFlight = new Map<string, Promise<DailySendResult>>();

	constructor(
		private readonly handle: DatabaseHandle,
		private readonly config: AppConfig,
		private readonly telegram: TelegramService | null = null,
		private readonly embeddings: EmbeddingService | null = null,
		private readonly clock: () => Date = () => new Date(),
	) {}

	private nowIso(): string {
		return this.clock().toISOString();
	}

	today(): string {
		return localDateString(new Date(), this.config.appTimezone);
	}

	private quoteById(id: number | null): Quote | null {
		if (id === null) return null;
		const row = getQuoteRow(this.handle, id);
		return row ? rowToQuote(row) : null;
	}

	private hydrate(record: DailyBatchRecord): DailyBatch {
		const starred = this.quoteById(record.starred_quote_id);
		const unstarred = this.quoteById(record.unstarred_quote_id);
		const warnings: string[] = [];
		if (record.starred_quote_id === null) {
			warnings.push("No starred quote was available.");
		} else if (!starred) {
			warnings.push("The starred quote was deleted.");
		}
		if (record.unstarred_quote_id === null) {
			warnings.push("No Inbox quote was available.");
		} else if (!unstarred) {
			warnings.push("The Inbox quote was deleted.");
		}
		return {
			id: record.id,
			date: record.local_date,
			channel: record.channel,
			createdAt: record.created_at,
			sendState: record.send_state,
			sentAt: record.sent_at,
			telegramMessageId: record.telegram_message_id,
			attempts: record.attempts,
			lastAttemptAt: record.last_attempt_at,
			lastError: record.last_error,
			starred,
			unstarred,
			warnings,
		};
	}

	private pick(status: "starred" | "inbox", date: string): Quote | null {
		const rows = this.handle.sqlite
			.prepare(
				`SELECT * FROM quotes
				 WHERE status = ?
				 ORDER BY last_sent_at IS NULL DESC, last_sent_at ASC, id ASC`,
			)
			.all(status) as Array<Parameters<typeof mapQuoteRow>[0]>;
		if (rows.length === 0) return null;
		const cohortSize = Math.min(
			rows.length,
			Math.max(
				this.config.daily.minCohort,
				Math.ceil(rows.length * this.config.daily.cohortFraction),
			),
		);
		// Deterministic per date so a preview and the committed pair agree.
		const seed = createHash("sha256")
			.update(
				`${date}:${status === "starred" ? "starred" : "unstarred"}:${rows.map((row) => row.id).join(",")}`,
			)
			.digest();
		const chosen = rows[seed.readUInt32BE(0) % cohortSize];
		return chosen ? rowToQuote(mapQuoteRow(chosen)) : null;
	}

	private pickPair(date: string): { starred: Quote | null; unstarred: Quote | null } {
		return { starred: this.pick("starred", date), unstarred: this.pick("inbox", date) };
	}

	private record(date: string): DailyBatchRecord | null {
		const row = this.handle.sqlite
			.prepare("SELECT * FROM daily_batches WHERE local_date = ?")
			.get(date) as DailyBatchRecord | undefined;
		return row ?? null;
	}

	preview(date = this.today()): DailyBatch {
		const { starred, unstarred } = this.pickPair(date);
		const warnings: string[] = [];
		if (!starred) warnings.push("No starred quotes are available.");
		if (!unstarred) warnings.push("No Inbox quotes are available.");
		return {
			id: `preview-${date}`,
			date,
			channel: "preview",
			createdAt: this.nowIso(),
			sendState: "pending",
			sentAt: null,
			telegramMessageId: null,
			attempts: 0,
			lastAttemptAt: null,
			lastError: null,
			starred,
			unstarred,
			warnings,
		};
	}

	get(date = this.today()): DailyBatch | null {
		const record = this.record(date);
		return record ? this.hydrate(record) : null;
	}

	private insertBatch(
		date: string,
		channel: string,
		starred: Quote | null,
		unstarred: Quote | null,
	): DailyBatchRecord {
		const id = randomUUID();
		const createdAt = this.nowIso();
		this.handle.sqlite
			.prepare(
				`INSERT INTO daily_batches(
					 id, local_date, starred_quote_id, unstarred_quote_id, channel, created_at,
					 send_state, sent_at, telegram_message_id, attempts, last_attempt_at, last_error
				 )
				 VALUES(?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, NULL)`,
			)
			.run(id, date, starred?.id ?? null, unstarred?.id ?? null, channel, createdAt);
		return {
			id,
			local_date: date,
			starred_quote_id: starred?.id ?? null,
			unstarred_quote_id: unstarred?.id ?? null,
			channel,
			created_at: createdAt,
			send_state: "pending",
			sent_at: null,
			telegram_message_id: null,
			attempts: 0,
			last_attempt_at: null,
			last_error: null,
		};
	}

	/**
	 * Record the deliveries, sent metadata, and auto-drop of the Inbox quote.
	 * Must run inside a transaction. Returns the ids dropped by this call.
	 */
	private finalize(
		record: DailyBatchRecord,
		options: {
			channel: string;
			sentAt: string;
			telegramMessageId: number | null;
			starredSnapshot: Quote | null;
			unstarredSnapshot: Quote | null;
		},
	): number[] {
		const droppedIds: number[] = [];
		const pairs: Array<{ quote: Quote | null; starred: boolean }> = [
			{ quote: options.starredSnapshot, starred: true },
			{ quote: options.unstarredSnapshot, starred: false },
		];
		for (const { quote, starred } of pairs) {
			if (!quote) continue;
			const current = getQuoteRow(this.handle, quote.id);
			this.handle.sqlite
				.prepare(
					`INSERT OR IGNORE INTO deliveries(
						 batch_id, quote_id, quote_text, quote_author, starred_snapshot, channel, sent_at
					 )
					 VALUES(?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					record.id,
					current ? quote.id : null,
					quote.text,
					quote.author,
					starred ? 1 : 0,
					options.channel,
					options.sentAt,
				);
			if (current) {
				this.handle.sqlite
					.prepare("UPDATE quotes SET last_sent_at = ?, sent_count = sent_count + 1 WHERE id = ?")
					.run(options.sentAt, quote.id);
			}
		}

		// Auto-drop only while the Inbox quote is still Inbox; a manual status
		// change made between selection and commit wins.
		const unstarred = record.unstarred_quote_id;
		if (unstarred !== null) {
			const row = getQuoteRow(this.handle, unstarred);
			if (row && row.status === "inbox") {
				this.handle.sqlite
					.prepare(
						`UPDATE quotes
						 SET status = 'dropped', dropped_at = ?, dropped_from = 'inbox', drop_source = 'daily'
						 WHERE id = ?`,
					)
					.run(options.sentAt, unstarred);
				ftsDelete(this.handle.sqlite, unstarred);
				this.handle.sqlite
					.prepare("DELETE FROM quote_embeddings WHERE quote_id = ?")
					.run(unstarred);
				droppedIds.push(unstarred);
			}
		}

		this.handle.sqlite
			.prepare(
				`UPDATE daily_batches
				 SET send_state = 'sent', sent_at = ?, telegram_message_id = ?,
				     channel = ?, attempts = attempts + 1, last_attempt_at = ?, last_error = NULL
				 WHERE id = ?`,
			)
			.run(options.sentAt, options.telegramMessageId, options.channel, options.sentAt, record.id);
		return droppedIds;
	}

	private removeDroppedVectors(ids: number[]): void {
		for (const id of ids) this.embeddings?.removeQuoteVector(id);
	}

	/** Reselect any recorded quote that is no longer eligible for its slot. */
	private revalidate(record: DailyBatchRecord, date: string): DailyBatchRecord | null {
		const currentStarred =
			record.starred_quote_id !== null ? getQuoteRow(this.handle, record.starred_quote_id) : null;
		const currentUnstarred =
			record.unstarred_quote_id !== null
				? getQuoteRow(this.handle, record.unstarred_quote_id)
				: null;
		const nextStarred =
			currentStarred?.status === "starred"
				? rowToQuote(currentStarred)
				: this.pick("starred", date);
		const nextUnstarred =
			currentUnstarred?.status === "inbox"
				? rowToQuote(currentUnstarred)
				: this.pick("inbox", date);
		const changed =
			(nextStarred?.id ?? null) !== record.starred_quote_id ||
			(nextUnstarred?.id ?? null) !== record.unstarred_quote_id;
		if (changed) {
			this.handle.sqlite
				.prepare(
					"UPDATE daily_batches SET starred_quote_id = ?, unstarred_quote_id = ? WHERE id = ?",
				)
				.run(nextStarred?.id ?? null, nextUnstarred?.id ?? null, record.id);
		}
		if (!nextStarred && !nextUnstarred) {
			this.handle.sqlite.prepare("DELETE FROM daily_batches WHERE id = ?").run(record.id);
			return null;
		}
		return this.record(date);
	}

	commit(input: { date?: string; channel?: string }): {
		batch: DailyBatch;
		alreadyExisted: boolean;
	} {
		const date = input.date ?? this.today();
		const channel = input.channel?.trim() || "api";
		const run = this.handle.sqlite.transaction(() => {
			const existing = this.record(date);
			if (existing?.send_state === "sent") {
				return { batch: this.hydrate(existing), alreadyExisted: true, dropped: [] as number[] };
			}
			let record = existing;
			if (record) {
				record = this.revalidate(record, date);
				if (!record) throw badRequest("Cannot record a daily pair: there are no eligible quotes");
			} else {
				const pair = this.pickPair(date);
				if (!pair.starred && !pair.unstarred) {
					throw badRequest("Cannot create a daily pair: there are no quotes");
				}
				record = this.insertBatch(date, channel, pair.starred, pair.unstarred);
			}
			const starred = this.quoteById(record.starred_quote_id);
			const unstarred = this.quoteById(record.unstarred_quote_id);
			const sentAt = this.nowIso();
			const dropped = this.finalize(record, {
				channel,
				sentAt,
				telegramMessageId: null,
				starredSnapshot: starred,
				unstarredSnapshot: unstarred,
			});
			const updated = this.record(date);
			if (!updated) throw new Error("Failed to read daily batch after commit");
			return { batch: this.hydrate(updated), alreadyExisted: Boolean(existing), dropped };
		});
		const result = run.immediate();
		this.removeDroppedVectors(result.dropped);
		return { batch: result.batch, alreadyExisted: result.alreadyExisted };
	}

	send(date = this.today()): Promise<DailySendResult> {
		const pending = this.inFlight.get(date);
		if (pending) return pending;
		const promise = this.performSend(date).finally(() => {
			this.inFlight.delete(date);
		});
		this.inFlight.set(date, promise);
		return promise;
	}

	private async performSend(date: string): Promise<DailySendResult> {
		if (!this.telegram?.enabled) {
			throw badRequest("Telegram is not configured; set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
		}

		let record = this.record(date);
		if (record?.send_state === "sent") {
			return { batch: this.hydrate(record), alreadySent: true };
		}

		if (record) {
			// Revalidate a pending retry: statuses may have changed since selection.
			record = this.revalidate(record, date);
			if (!record) return { batch: null, alreadySent: false };
		} else {
			const pair = this.pickPair(date);
			if (!pair.starred && !pair.unstarred) return { batch: null, alreadySent: false };
			record = this.insertBatch(date, "telegram", pair.starred, pair.unstarred);
		}

		const starred = this.quoteById(record.starred_quote_id);
		const unstarred = this.quoteById(record.unstarred_quote_id);
		const html = formatDailyMessage({
			date,
			starred,
			unstarred,
			publicOrigin: this.config.publicOrigin,
		});

		let messageId: number | null;
		try {
			messageId = await this.telegram.sendMessage(html);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Telegram send failed";
			this.handle.sqlite
				.prepare(
					`UPDATE daily_batches
					 SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
					 WHERE id = ?`,
				)
				.run(this.nowIso(), message.slice(0, 500), record.id);
			throw error;
		}

		const sentAt = this.nowIso();
		const run = this.handle.sqlite.transaction(() => {
			const current = this.record(date);
			if (!current) return { batch: null as DailyBatch | null, dropped: [] as number[] };
			if (current.send_state === "sent") {
				return { batch: this.hydrate(current), dropped: [] as number[] };
			}
			const dropped = this.finalize(current, {
				channel: "telegram",
				sentAt,
				telegramMessageId: messageId,
				starredSnapshot: starred,
				unstarredSnapshot: unstarred,
			});
			const updated = this.record(date);
			return {
				batch: updated ? this.hydrate(updated) : null,
				dropped,
			};
		});
		const result = run.immediate();
		this.removeDroppedVectors(result.dropped);
		return { batch: result.batch, alreadySent: false };
	}

	listDeliveries(options: {
		cursor?: string;
		limit?: number;
		channel?: string;
		starred?: boolean;
		from?: string;
		to?: string;
	}): DeliveryListResponse {
		const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (options.channel) {
			clauses.push("channel = ?");
			params.push(options.channel);
		}
		if (options.starred !== undefined) {
			clauses.push("starred_snapshot = ?");
			params.push(options.starred ? 1 : 0);
		}
		if (options.from) {
			clauses.push("sent_at >= ?");
			params.push(options.from);
		}
		if (options.to) {
			clauses.push("sent_at <= ?");
			params.push(options.to);
		}
		if (options.cursor) {
			const cursor = decodeCursor<{ sentAt: string; id: number }>(options.cursor);
			clauses.push("(sent_at < ? OR (sent_at = ? AND id < ?))");
			params.push(cursor.sentAt, cursor.sentAt, cursor.id);
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.handle.sqlite
			.prepare(`SELECT * FROM deliveries ${where} ORDER BY sent_at DESC, id DESC LIMIT ?`)
			.all(...params, limit + 1) as DeliveryRecord[];
		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(
			(row): Delivery => ({
				id: row.id,
				batchId: row.batch_id,
				quoteId: row.quote_id,
				quoteText: row.quote_text,
				quoteAuthor: row.quote_author,
				starred: Boolean(row.starred_snapshot),
				channel: row.channel,
				sentAt: row.sent_at,
				date: localDateString(new Date(row.sent_at), this.config.appTimezone),
			}),
		);
		const last = rows[limit - 1];
		const nextCursor = hasMore && last ? encodeCursor({ sentAt: last.sent_at, id: last.id }) : null;
		return { items, nextCursor };
	}

	stats() {
		const quotes = this.handle.sqlite
			.prepare(
				`SELECT id, author, status, created_at, last_sent_at
				 FROM quotes WHERE status != 'dropped'
				 ORDER BY created_at`,
			)
			.all() as Array<{
			id: number;
			author: string;
			status: string;
			created_at: string;
			last_sent_at: string | null;
		}>;
		const deliveries = this.handle.sqlite
			.prepare("SELECT sent_at, channel, quote_id FROM deliveries ORDER BY sent_at")
			.all() as Array<{ sent_at: string; channel: string; quote_id: number | null }>;
		const counts = statusCounts(this.handle);

		const total = quotes.length;
		const neverSent = quotes.filter((quote) => quote.last_sent_at === null).length;
		const authors = new Set(quotes.map((quote) => quote.author.trim().toLowerCase())).size;
		const sentDistinct = new Set(
			deliveries.map((delivery) => delivery.quote_id).filter((id): id is number => id !== null),
		).size;
		const topAuthorRows = this.handle.sqlite
			.prepare(
				`SELECT author, COUNT(*) AS count
				 FROM quotes
				 WHERE status != 'dropped'
				 GROUP BY author_key
				 ORDER BY count DESC, author ASC
				 LIMIT 10`,
			)
			.all() as Array<{ author: string; count: number }>;

		const monthCount = (dates: string[]) => {
			const countsByMonth = new Map<string, number>();
			for (const date of dates) {
				const month = localDateString(new Date(date), this.config.appTimezone).slice(0, 7);
				countsByMonth.set(month, (countsByMonth.get(month) ?? 0) + 1);
			}
			return monthKeys(12, this.today()).map((month) => ({
				month,
				count: countsByMonth.get(month) ?? 0,
			}));
		};

		const last30Keys = dateRange(30, this.today());
		const dayCounts = new Map<string, number>();
		for (const delivery of deliveries) {
			const day = localDateString(new Date(delivery.sent_at), this.config.appTimezone);
			dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
		}
		const activeDays = new Set(dayCounts.keys());
		let streakDays = 0;
		let streakCursor = localDateString(new Date(), this.config.appTimezone);
		if (!activeDays.has(streakCursor)) streakCursor = previousDate(streakCursor);
		while (activeDays.has(streakCursor)) {
			streakDays += 1;
			streakCursor = previousDate(streakCursor);
		}
		const byChannel = new Map<string, number>();
		for (const delivery of deliveries) {
			byChannel.set(delivery.channel, (byChannel.get(delivery.channel) ?? 0) + 1);
		}
		const last30Start = new Date();
		last30Start.setUTCDate(last30Start.getUTCDate() - 30);
		const last30 = deliveries.filter(
			(delivery) => new Date(delivery.sent_at).getTime() >= last30Start.getTime(),
		).length;

		return {
			totals: {
				quotes: total,
				starred: counts.starred,
				inbox: counts.inbox,
				private: counts.private,
				dropped: counts.dropped,
				authors,
				neverSent,
				sentDistinct,
			},
			additionsByMonth: monthCount(quotes.map((quote) => quote.created_at)),
			deliveriesByMonth: monthCount(deliveries.map((delivery) => delivery.sent_at)),
			topAuthors: topAuthorRows.map((row) => ({ author: row.author, count: Number(row.count) })),
			deliveries: {
				total: deliveries.length,
				last30,
				streakDays,
				byChannel: [...byChannel.entries()]
					.map(([channel, count]) => ({ channel, count }))
					.sort((a, b) => b.count - a.count),
				last30Days: last30Keys.map((date) => ({ date, count: dayCounts.get(date) ?? 0 })),
			},
		};
	}
}
