import type { ActiveQuoteStatus, DailySendState, DropSource, QuoteStatus } from "@quotan/shared";
import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const quotes = sqliteTable(
	"quotes",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		text: text("text").notNull(),
		author: text("author").notNull(),
		status: text("status").$type<QuoteStatus>().notNull().default("inbox"),
		droppedAt: text("dropped_at"),
		droppedFrom: text("dropped_from").$type<ActiveQuoteStatus>(),
		dropSource: text("drop_source").$type<DropSource>(),
		textKey: text("text_key").notNull(),
		authorKey: text("author_key").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		lastSentAt: text("last_sent_at"),
		sentCount: integer("sent_count").notNull().default(0),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		index("idx_quotes_created").on(table.createdAt, table.id),
		index("idx_quotes_status_last_sent").on(table.status, table.lastSentAt, table.id),
		index("idx_quotes_dropped_at").on(table.droppedAt, table.id),
		index("idx_quotes_last_sent").on(table.lastSentAt, table.id),
		index("idx_quotes_dedupe").on(table.dedupeKey),
		index("idx_quotes_text_key").on(table.textKey),
		index("idx_quotes_author_key").on(table.authorKey),
	],
);

export const quoteEmbeddings = sqliteTable(
	"quote_embeddings",
	{
		quoteId: integer("quote_id")
			.notNull()
			.references(() => quotes.id, { onDelete: "cascade" }),
		modelKey: text("model_key").notNull(),
		textKey: text("text_key").notNull(),
		dims: integer("dims").notNull(),
		vector: blob("vector", { mode: "buffer" }).notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.quoteId, table.modelKey] }),
		index("idx_embeddings_model").on(table.modelKey),
	],
);

export const dailyBatches = sqliteTable(
	"daily_batches",
	{
		id: text("id").primaryKey(),
		localDate: text("local_date").notNull().unique(),
		starredQuoteId: integer("starred_quote_id").references(() => quotes.id, {
			onDelete: "set null",
		}),
		unstarredQuoteId: integer("unstarred_quote_id").references(() => quotes.id, {
			onDelete: "set null",
		}),
		channel: text("channel").notNull(),
		createdAt: text("created_at").notNull(),
		sendState: text("send_state").$type<DailySendState>().notNull().default("sent"),
		sentAt: text("sent_at"),
		telegramMessageId: integer("telegram_message_id"),
		attempts: integer("attempts").notNull().default(0),
		lastAttemptAt: text("last_attempt_at"),
		lastError: text("last_error"),
	},
	(table) => [index("idx_daily_date").on(table.localDate)],
);

export const deliveries = sqliteTable(
	"deliveries",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		batchId: text("batch_id")
			.notNull()
			.references(() => dailyBatches.id, { onDelete: "cascade" }),
		quoteId: integer("quote_id").references(() => quotes.id, { onDelete: "set null" }),
		quoteText: text("quote_text").notNull(),
		quoteAuthor: text("quote_author").notNull(),
		starredSnapshot: integer("starred_snapshot", { mode: "boolean" }).notNull(),
		channel: text("channel").notNull(),
		sentAt: text("sent_at").notNull(),
	},
	(table) => [
		index("idx_deliveries_sent").on(table.sentAt, table.id),
		index("idx_deliveries_quote").on(table.quoteId),
		index("idx_deliveries_channel").on(table.channel),
	],
);

export const sessions = sqliteTable(
	"sessions",
	{
		tokenHash: text("token_hash").primaryKey(),
		createdAt: text("created_at").notNull(),
		expiresAt: text("expires_at").notNull(),
		lastSeenAt: text("last_seen_at").notNull(),
	},
	(table) => [index("idx_sessions_expires").on(table.expiresAt)],
);

export const importBatches = sqliteTable("import_batches", {
	id: text("id").primaryKey(),
	createdAt: text("created_at").notNull(),
	statsJson: text("stats_json").notNull(),
});

export const duplicateIgnoredGroups = sqliteTable("duplicate_ignored_groups", {
	groupKey: text("group_key").primaryKey(),
	createdAt: text("created_at").notNull(),
});

export const appMeta = sqliteTable("app_meta", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export type QuoteRow = typeof quotes.$inferSelect;
export type NewQuoteRow = typeof quotes.$inferInsert;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DailyBatchRow = typeof dailyBatches.$inferSelect;
