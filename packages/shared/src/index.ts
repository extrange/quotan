import { z } from "zod";

export const APP_NAME = "Quotan";
export const APP_VERSION = "0.1.0";
export const EXPORT_VERSION = 1;

export const SortSchema = z.enum(["newest", "oldest", "author", "last_sent"]);
export type Sort = z.infer<typeof SortSchema>;

export const QuoteStatusSchema = z.enum(["starred", "inbox", "private", "dropped"]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

/** Statuses a quote can be moved into directly; Dropped is only reached through a drop. */
export const ActiveQuoteStatusSchema = z.enum(["starred", "inbox", "private"]);
export type ActiveQuoteStatus = z.infer<typeof ActiveQuoteStatusSchema>;

export const DropSourceSchema = z.enum(["quote", "duplicates", "bulk", "daily"]);
export type DropSource = z.infer<typeof DropSourceSchema>;

/** Sources a user may pick when archiving; `daily` is reserved for the sender. */
export const ManualDropSourceSchema = z.enum(["quote", "duplicates", "bulk"]);
export type ManualDropSource = z.infer<typeof ManualDropSourceSchema>;

export const QuoteSchema = z.object({
	id: z.number().int(),
	text: z.string(),
	author: z.string(),
	status: QuoteStatusSchema,
	droppedAt: z.string().nullable(),
	droppedFrom: ActiveQuoteStatusSchema.nullable(),
	dropSource: DropSourceSchema.nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	lastSentAt: z.string().nullable(),
	sentCount: z.number().int(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const CreateQuoteSchema = z.object({
	text: z.string().trim().min(1, "Quote text is required"),
	author: z.string().trim().min(1, "Author is required"),
	status: ActiveQuoteStatusSchema.optional(),
	/** @deprecated Legacy alias: true → starred, false → inbox. */
	starred: z.boolean().optional(),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

export const UpdateQuoteSchema = z
	.object({
		text: z.string().trim().min(1).optional(),
		author: z.string().trim().min(1).optional(),
		status: ActiveQuoteStatusSchema.optional(),
		/** @deprecated Legacy alias: true → starred, false → inbox. */
		starred: z.boolean().optional(),
	})
	.refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteSchema>;

export const BulkDeleteQuotesSchema = z.object({
	ids: z.array(z.number().int().positive()).min(1),
	source: ManualDropSourceSchema.optional().default("bulk"),
});
export type BulkDeleteQuotesInput = z.infer<typeof BulkDeleteQuotesSchema>;

export const BulkDeleteQuotesResponseSchema = z.object({
	archived: z.number().int(),
});
export type BulkDeleteQuotesResponse = z.infer<typeof BulkDeleteQuotesResponseSchema>;

export const RestoreQuoteSchema = z.object({
	status: ActiveQuoteStatusSchema,
});
export type RestoreQuoteInput = z.infer<typeof RestoreQuoteSchema>;

export const QuoteListQuerySchema = z.object({
	status: ActiveQuoteStatusSchema.optional(),
	/** @deprecated Legacy alias: true → starred, false → inbox. */
	starred: z.boolean().optional(),
	sent: z.boolean().optional(),
	author: z.string().trim().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	sort: SortSchema.optional().default("newest"),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional().default(50),
});
export type QuoteListQuery = z.infer<typeof QuoteListQuerySchema>;

export const QuoteListResponseSchema = z.object({
	items: z.array(QuoteSchema),
	nextCursor: z.string().nullable(),
	total: z.number().int(),
});
export type QuoteListResponse = z.infer<typeof QuoteListResponseSchema>;

export const DroppedListQuerySchema = z.object({
	q: z.string().trim().max(500).optional(),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional().default(50),
});
export type DroppedListQuery = z.infer<typeof DroppedListQuerySchema>;

export const SearchQuerySchema = z.object({
	q: z.string().trim().min(1).max(500),
	status: ActiveQuoteStatusSchema.optional(),
	/** @deprecated Legacy alias: true → starred, false → inbox. */
	starred: z.boolean().optional(),
	sent: z.boolean().optional(),
	author: z.string().trim().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional().default(50),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = QuoteSchema.extend({
	score: z.number(),
	keywordRank: z.number().int().nullable(),
	vectorRank: z.number().int().nullable(),
	similarity: z.number().nullable(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
	items: z.array(SearchResultSchema),
	mode: z.enum(["hybrid", "keyword"]),
	total: z.number().int(),
	tookMs: z.number(),
	warning: z.string().optional(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const DuplicateCategorySchema = z.enum(["exact", "same_text", "likely", "similar"]);
export type DuplicateCategory = z.infer<typeof DuplicateCategorySchema>;

export const DuplicateMatchSchema = z.object({
	quote: QuoteSchema,
	category: DuplicateCategorySchema,
	similarity: z.number().nullable(),
	trigram: z.number(),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

export const DuplicateCheckSchema = z.object({
	text: z.string().trim().min(1),
	author: z.string().trim().optional().default(""),
	excludeId: z.number().int().optional(),
});
export type DuplicateCheckInput = z.infer<typeof DuplicateCheckSchema>;

export const DuplicateCheckResponseSchema = z.object({
	verdict: z.enum(["exact", "same_text", "likely", "similar", "none"]),
	matches: z.array(DuplicateMatchSchema),
	embeddingUsed: z.boolean(),
});
export type DuplicateCheckResponse = z.infer<typeof DuplicateCheckResponseSchema>;

export const DuplicateGroupSchema = z.object({
	key: z.string(),
	category: DuplicateCategorySchema,
	quotes: z.array(QuoteSchema).min(2),
	similarity: z.number().nullable(),
	trigram: z.number(),
	ignored: z.boolean(),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

export const DuplicateIgnoreSchema = z.object({
	key: z.string().trim().min(1).max(200),
	ignored: z.boolean(),
});
export type DuplicateIgnoreInput = z.infer<typeof DuplicateIgnoreSchema>;

export const DuplicateIgnoreResponseSchema = z.object({
	key: z.string(),
	ignored: z.boolean(),
});
export type DuplicateIgnoreResponse = z.infer<typeof DuplicateIgnoreResponseSchema>;

export const DuplicateScanResponseSchema = z.object({
	groups: z.array(DuplicateGroupSchema),
	totalGroups: z.number().int(),
	scanned: z.number().int(),
	totalQuotes: z.number().int(),
	embeddingUsed: z.boolean(),
	warning: z.string().optional(),
});
export type DuplicateScanResponse = z.infer<typeof DuplicateScanResponseSchema>;

export const DailySendStateSchema = z.enum(["pending", "sent"]);
export type DailySendState = z.infer<typeof DailySendStateSchema>;

export const DailyBatchSchema = z.object({
	id: z.string(),
	date: z.string(),
	channel: z.string(),
	createdAt: z.string(),
	sendState: DailySendStateSchema,
	sentAt: z.string().nullable(),
	telegramMessageId: z.number().int().nullable(),
	attempts: z.number().int(),
	lastAttemptAt: z.string().nullable(),
	lastError: z.string().nullable(),
	starred: QuoteSchema.nullable(),
	unstarred: QuoteSchema.nullable(),
	warnings: z.array(z.string()),
});
export type DailyBatch = z.infer<typeof DailyBatchSchema>;

export const DailyCommitSchema = z.object({
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	channel: z.string().trim().min(1).max(40).optional().default("api"),
});
export type DailyCommitInput = z.infer<typeof DailyCommitSchema>;

export const DailyResponseSchema = z.object({
	batch: DailyBatchSchema.nullable(),
});
export type DailyResponse = z.infer<typeof DailyResponseSchema>;

export const DailySendResponseSchema = z.object({
	batch: DailyBatchSchema.nullable(),
	alreadySent: z.boolean(),
});
export type DailySendResponse = z.infer<typeof DailySendResponseSchema>;

export const DeliverySchema = z.object({
	id: z.number().int(),
	batchId: z.string(),
	quoteId: z.number().int().nullable(),
	quoteText: z.string(),
	quoteAuthor: z.string(),
	starred: z.boolean(),
	channel: z.string(),
	sentAt: z.string(),
	date: z.string(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const DeliveryListResponseSchema = z.object({
	items: z.array(DeliverySchema),
	nextCursor: z.string().nullable(),
});
export type DeliveryListResponse = z.infer<typeof DeliveryListResponseSchema>;

export const IndexStatusSchema = z.object({
	provider: z.string(),
	model: z.string(),
	modelKey: z.string(),
	dimensions: z.number().int(),
	state: z.enum(["ready", "indexing", "stale", "error", "disabled"]),
	total: z.number().int(),
	indexed: z.number().int(),
	pending: z.number().int(),
	processed: z.number().int(),
	error: z.string().nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
});
export type IndexStatus = z.infer<typeof IndexStatusSchema>;

export const StatsSchema = z.object({
	totals: z.object({
		quotes: z.number().int(),
		starred: z.number().int(),
		inbox: z.number().int(),
		private: z.number().int(),
		dropped: z.number().int(),
		authors: z.number().int(),
		neverSent: z.number().int(),
		sentDistinct: z.number().int(),
	}),
	additionsByMonth: z.array(z.object({ month: z.string(), count: z.number().int() })),
	deliveriesByMonth: z.array(z.object({ month: z.string(), count: z.number().int() })),
	topAuthors: z.array(z.object({ author: z.string(), count: z.number().int() })),
	deliveries: z.object({
		total: z.number().int(),
		last30: z.number().int(),
		streakDays: z.number().int(),
		byChannel: z.array(z.object({ channel: z.string(), count: z.number().int() })),
		last30Days: z.array(z.object({ date: z.string(), count: z.number().int() })),
	}),
	index: IndexStatusSchema,
});
export type Stats = z.infer<typeof StatsSchema>;

export const TelegramSettingsSchema = z.object({
	enabled: z.boolean(),
	configured: z.boolean(),
	chatIdMasked: z.string().nullable(),
	sendTime: z.string(),
	timezone: z.string(),
});
export type TelegramSettings = z.infer<typeof TelegramSettingsSchema>;

export const SettingsSchema = z.object({
	telegram: TelegramSettingsSchema,
	version: z.string(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ImportRowInputSchema = z.object({
	text: z.string().trim(),
	author: z.string().trim().optional(),
	status: ActiveQuoteStatusSchema.optional(),
	/** @deprecated Legacy alias: true → starred, false → inbox. */
	starred: z.boolean().optional(),
	createdAt: z.string().optional(),
});
export type ImportRowInput = z.infer<typeof ImportRowInputSchema>;

export const ImportCommitRequestSchema = z.object({
	batchId: z.string().min(1).max(100),
	rows: z.array(ImportRowInputSchema).min(1).max(20000),
});
export type ImportCommitInput = z.infer<typeof ImportCommitRequestSchema>;

export const ImportReportSchema = z.object({
	batchId: z.string(),
	imported: z.number().int(),
	invalid: z.number().int(),
	skippedDuplicates: z.number().int(),
	skippedDropped: z.number().int(),
	importedIds: z.array(z.number().int()),
	rows: z.array(
		z.object({
			index: z.number().int(),
			quoteId: z.number().int().nullable(),
			duplicateOfId: z.number().int().optional(),
			duplicateOfStatus: QuoteStatusSchema.optional(),
			message: z.string().optional(),
		}),
	),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const LoginRequestSchema = z.object({
	password: z.string().min(1).max(1000),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthMeSchema = z.object({
	authenticated: z.boolean(),
	label: z.string().optional(),
	apiKeyConfigured: z.boolean().optional(),
});
export type AuthMe = z.infer<typeof AuthMeSchema>;

export const ExportEnvelopeSchema = z.object({
	version: z.number().int(),
	exportedAt: z.string(),
	count: z.number().int(),
	quotes: z.array(QuoteSchema),
});
export type ExportEnvelope = z.infer<typeof ExportEnvelopeSchema>;

export const ErrorResponseSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		details: z.unknown().optional(),
	}),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const API_PREFIX = "/api";
