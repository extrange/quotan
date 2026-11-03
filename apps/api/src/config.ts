import { dirname, join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ quiet: true });

const boolString = z
	.string()
	.optional()
	.transform((value) => {
		if (value === undefined || value.trim() === "") return undefined;
		return ["1", "true", "yes", "on"].includes(value.toLowerCase());
	});

const commaList = z
	.string()
	.optional()
	.transform((value) =>
		(value ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean),
	);

const envSchema = z.object({
	NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	HOST: z.string().default("0.0.0.0"),
	DATABASE_PATH: z.string().default("./data/quotan.sqlite"),
	APP_TIMEZONE: z.string().default("Asia/Singapore"),
	PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
	TRUST_PROXY: boolString,
	COOKIE_SECURE: boolString,
	LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
	RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
	LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
	SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
	AUTH_LABEL: z.string().default("Private quote library"),
	AUTH_PASSWORD_HASH: z.string().optional(),
	AUTH_PASSWORD: z.string().optional(),
	API_KEY: z.string().optional(),

	EMBEDDING_PROVIDER: z.enum(["local", "mock", "none"]).default("local"),
	EMBEDDING_MODEL: z.string().min(1).optional(),
	EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(8192).optional(),
	EMBEDDING_CACHE_DIR: z.string().min(1).optional(),
	EMBEDDING_DTYPE: z.enum(["q8", "fp32", "fp16", "q4"]).default("q8"),
	EMBEDDING_POOLING: z.enum(["mean", "cls", "first_token", "eos", "last_token"]).default("cls"),
	EMBEDDING_ALLOW_REMOTE: boolString,
	EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(256).default(16),
	EMBEDDING_MAX_CHARS: z.coerce.number().int().min(100).max(50000).default(16000),
	EMBEDDING_DOCUMENT_PREFIX: z.string().default(""),
	EMBEDDING_QUERY_PREFIX: z.string().default(""),
	EMBEDDING_RETRY_INTERVAL_MS: z.coerce.number().int().min(5000).default(60000),
	AUTO_REINDEX: boolString,

	SEARCH_RRF_K: z.coerce.number().int().min(1).max(1000).default(60),
	SEARCH_KEYWORD_WEIGHT: z.coerce.number().min(0).max(100).default(1),
	SEARCH_VECTOR_WEIGHT: z.coerce.number().min(0).max(100).default(1),
	SEARCH_VECTOR_CANDIDATES: z.coerce.number().int().min(1).max(1000).default(100),
	SEARCH_EXACT_BOOST: z.coerce.number().min(0).max(1).default(0.02),
	SEARCH_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.2),

	DUPLICATE_SIMILAR_THRESHOLD: z.coerce.number().min(0).max(1).default(0.82),
	DUPLICATE_LIKELY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.95),
	DUPLICATE_TRIGRAM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
	DUPLICATE_CLUSTER_SIMILARITY: z.coerce.number().min(0).max(1).default(0.9),
	DUPLICATE_CLUSTER_TRIGRAM: z.coerce.number().min(0).max(1).default(0.98),

	IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(50000).default(20000),
	IMPORT_BODY_LIMIT_MB: z.coerce.number().int().min(1).max(100).default(25),

	DAILY_COHORT_FRACTION: z.coerce.number().min(0).max(1).default(0.25),
	DAILY_MIN_COHORT: z.coerce.number().int().min(1).max(100).default(5),

	TELEGRAM_ENABLED: boolString,
	TELEGRAM_BOT_TOKEN: z.string().optional(),
	TELEGRAM_CHAT_ID: z.string().optional(),
	TELEGRAM_API_BASE: z.string().url().default("https://api.telegram.org"),
	DAILY_SEND_TIME: z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "DAILY_SEND_TIME must be HH:MM")
		.default("09:00"),
	DAILY_SEND_RETRY_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
	DAILY_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),

	CORS_ORIGINS: commaList,
	DOCS_ENABLED: boolString,
	WEB_DIST_PATH: z.string().optional(),
});

export interface EmbeddingConfig {
	provider: "local" | "mock" | "none";
	model: string;
	dimensions: number;
	cacheDir: string;
	dtype: "q8" | "fp32" | "fp16" | "q4";
	pooling: "mean" | "cls" | "first_token" | "eos" | "last_token";
	allowRemoteModels: boolean;
	batchSize: number;
	maxChars: number;
	documentPrefix: string;
	queryPrefix: string;
	retryIntervalMs: number;
	autoReindex: boolean;
}

export interface SearchConfig {
	rrfK: number;
	keywordWeight: number;
	vectorWeight: number;
	vectorCandidates: number;
	exactBoost: number;
	minSimilarity: number;
	similarThreshold: number;
	likelyThreshold: number;
	trigramThreshold: number;
	clusterSimilarity: number;
	clusterTrigram: number;
}

export interface ImportConfig {
	maxRows: number;
	bodyLimitBytes: number;
}

export interface DailyConfig {
	cohortFraction: number;
	minCohort: number;
}

export interface TelegramConfig {
	enabled: boolean;
	configured: boolean;
	botToken: string | undefined;
	chatId: string | undefined;
	chatIdMasked: string | null;
	sendTime: string;
	apiBase: string;
	timezone: string;
	retrySeconds: number;
	checkIntervalSeconds: number;
}

export interface AppConfig {
	nodeEnv: "development" | "test" | "production";
	isProduction: boolean;
	host: string;
	port: number;
	databasePath: string;
	appTimezone: string;
	publicOrigin: string;
	trustProxy: boolean;
	cookieSecure: boolean;
	logLevel: string;
	rateLimitMax: number;
	loginRateLimitMax: number;
	sessionTtlDays: number;
	authLabel: string;
	authPasswordHash: string | undefined;
	authPassword: string | undefined;
	apiKey: string;
	embedding: EmbeddingConfig;
	search: SearchConfig;
	import: ImportConfig;
	daily: DailyConfig;
	telegram: TelegramConfig;
	corsOrigins: string[];
	docsEnabled: boolean;
	webDistPath: string | undefined;
	warnings: string[];
}

const providerDefaults = {
	local: {
		model: "onnx-community/granite-embedding-small-english-r2-ONNX",
		dimensions: 384,
	},
	mock: {
		model: "quotan-mock",
		dimensions: 64,
	},
	none: {
		model: "none",
		dimensions: 0,
	},
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const parsed = envSchema.safeParse(env);
	if (!parsed.success) {
		const message = parsed.error.issues
			.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid environment configuration:\n${message}`);
	}

	const raw = parsed.data;
	const warnings: string[] = [];
	const isProduction = raw.NODE_ENV === "production";

	const provider = raw.EMBEDDING_PROVIDER;
	const defaults = providerDefaults[provider];
	const model = raw.EMBEDDING_MODEL ?? defaults.model;
	const dimensions = provider === "none" ? 0 : (raw.EMBEDDING_DIMENSIONS ?? defaults.dimensions);
	const cacheDir = raw.EMBEDDING_CACHE_DIR ?? join(dirname(raw.DATABASE_PATH), "models");

	let authPasswordHash = raw.AUTH_PASSWORD_HASH;
	if (!authPasswordHash && raw.AUTH_PASSWORD) {
		authPasswordHash = undefined;
		warnings.push("AUTH_PASSWORD is set in plaintext; prefer AUTH_PASSWORD_HASH.");
	}
	if (!authPasswordHash && !raw.AUTH_PASSWORD) {
		if (isProduction) {
			throw new Error("AUTH_PASSWORD_HASH (or AUTH_PASSWORD for development) is required");
		}
		warnings.push("Using the development password 'quotan'. Set AUTH_PASSWORD_HASH.");
	}

	let apiKey = raw.API_KEY;
	if (!apiKey) {
		if (isProduction) throw new Error("API_KEY is required");
		apiKey = "dev-api-key-change-me";
		warnings.push("Using the development API key 'dev-api-key-change-me'.");
	}
	if (isProduction && apiKey.length < 24) {
		throw new Error("API_KEY must be at least 24 characters in production");
	}

	const telegramToken = raw.TELEGRAM_BOT_TOKEN?.trim() || undefined;
	const telegramChatId = raw.TELEGRAM_CHAT_ID?.trim() || undefined;
	if (Boolean(telegramToken) !== Boolean(telegramChatId)) {
		throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together");
	}
	const telegramConfigured = Boolean(telegramToken && telegramChatId);
	const telegramEnabled = raw.TELEGRAM_ENABLED ?? telegramConfigured;
	if (telegramEnabled && !telegramConfigured) {
		throw new Error("TELEGRAM_ENABLED requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");
	}
	const chatIdMasked = telegramChatId
		? `${"•".repeat(Math.max(0, Math.min(6, telegramChatId.length - 4)))}${telegramChatId.slice(-4)}`
		: null;

	const cookieSecure = raw.COOKIE_SECURE ?? isProduction;
	if (isProduction && !cookieSecure) {
		warnings.push("COOKIE_SECURE is disabled in production; login cookies will not be Secure.");
	}

	return {
		nodeEnv: raw.NODE_ENV,
		isProduction,
		host: raw.HOST,
		port: raw.PORT,
		databasePath: raw.DATABASE_PATH,
		appTimezone: raw.APP_TIMEZONE,
		publicOrigin: raw.PUBLIC_ORIGIN.replace(/\/$/, ""),
		trustProxy: raw.TRUST_PROXY ?? isProduction,
		cookieSecure,
		logLevel: raw.LOG_LEVEL,
		rateLimitMax: raw.RATE_LIMIT_MAX,
		loginRateLimitMax: raw.LOGIN_RATE_LIMIT_MAX,
		sessionTtlDays: raw.SESSION_TTL_DAYS,
		authLabel: raw.AUTH_LABEL,
		authPasswordHash,
		authPassword: raw.AUTH_PASSWORD,
		apiKey,
		embedding: {
			provider,
			model,
			dimensions,
			cacheDir,
			dtype: raw.EMBEDDING_DTYPE,
			pooling: raw.EMBEDDING_POOLING,
			allowRemoteModels: raw.EMBEDDING_ALLOW_REMOTE ?? true,
			batchSize: raw.EMBEDDING_BATCH_SIZE,
			maxChars: raw.EMBEDDING_MAX_CHARS,
			documentPrefix: raw.EMBEDDING_DOCUMENT_PREFIX,
			queryPrefix: raw.EMBEDDING_QUERY_PREFIX,
			retryIntervalMs: raw.EMBEDDING_RETRY_INTERVAL_MS,
			autoReindex: raw.AUTO_REINDEX ?? true,
		},
		search: {
			rrfK: raw.SEARCH_RRF_K,
			keywordWeight: raw.SEARCH_KEYWORD_WEIGHT,
			vectorWeight: raw.SEARCH_VECTOR_WEIGHT,
			vectorCandidates: raw.SEARCH_VECTOR_CANDIDATES,
			exactBoost: raw.SEARCH_EXACT_BOOST,
			minSimilarity: raw.SEARCH_MIN_SIMILARITY,
			similarThreshold: raw.DUPLICATE_SIMILAR_THRESHOLD,
			likelyThreshold: raw.DUPLICATE_LIKELY_THRESHOLD,
			trigramThreshold: raw.DUPLICATE_TRIGRAM_THRESHOLD,
			clusterSimilarity: raw.DUPLICATE_CLUSTER_SIMILARITY,
			clusterTrigram: raw.DUPLICATE_CLUSTER_TRIGRAM,
		},
		import: {
			maxRows: raw.IMPORT_MAX_ROWS,
			bodyLimitBytes: raw.IMPORT_BODY_LIMIT_MB * 1024 * 1024,
		},
		daily: {
			cohortFraction: raw.DAILY_COHORT_FRACTION,
			minCohort: raw.DAILY_MIN_COHORT,
		},
		telegram: {
			enabled: telegramEnabled,
			configured: telegramConfigured,
			botToken: telegramToken,
			chatId: telegramChatId,
			chatIdMasked,
			sendTime: raw.DAILY_SEND_TIME,
			apiBase: raw.TELEGRAM_API_BASE.replace(/\/$/, ""),
			timezone: raw.APP_TIMEZONE,
			retrySeconds: raw.DAILY_SEND_RETRY_SECONDS,
			checkIntervalSeconds: raw.DAILY_CHECK_INTERVAL_SECONDS,
		},
		corsOrigins: raw.CORS_ORIGINS,
		docsEnabled: raw.DOCS_ENABLED ?? true,
		webDistPath: raw.WEB_DIST_PATH,
		warnings,
	};
}
