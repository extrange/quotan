import type {
	ActiveQuoteStatus,
	AuthMe,
	BulkDeleteQuotesResponse,
	CreateQuoteInput,
	DailyBatch,
	DailyResponse,
	DailySendResponse,
	DeliveryListResponse,
	DuplicateCheckInput,
	DuplicateCheckResponse,
	DuplicateIgnoreResponse,
	DuplicateMatch,
	DuplicateScanResponse,
	ImportCommitInput,
	ImportReport,
	IndexStatus,
	LoginRequest,
	Quote,
	QuoteListResponse,
	SearchResponse,
	Settings,
	Stats,
	UpdateQuoteInput,
} from "@quotan/shared";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: unknown;

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

function queryString(params: object): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value)) {
			for (const item of value) search.append(key, String(item));
		} else {
			search.set(key, String(value));
		}
	}
	const result = search.toString();
	return result ? `?${result}` : "";
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	const response = await fetch(path, {
		...init,
		headers,
		credentials: "include",
	});
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	let payload: unknown = null;
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text;
		}
	}
	if (!response.ok) {
		if (response.status === 401 && typeof window !== "undefined") {
			window.dispatchEvent(new Event("quotan:unauthorized"));
		}
		const error = payload as
			| { error?: { code?: string; message?: string; details?: unknown } }
			| undefined;
		throw new ApiError(
			response.status,
			error?.error?.code ?? "REQUEST_FAILED",
			error?.error?.message ?? `Request failed (${response.status})`,
			error?.error?.details,
		);
	}
	return payload as T;
}

async function download(path: string, filename: string): Promise<void> {
	const response = await fetch(path, { credentials: "include" });
	if (!response.ok) {
		let message = `Download failed (${response.status})`;
		try {
			const payload = (await response.json()) as { error?: { message?: string } };
			message = payload.error?.message ?? message;
		} catch {
			// Keep the generic message.
		}
		throw new ApiError(response.status, "DOWNLOAD_FAILED", message);
	}
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export interface QuoteListParams {
	status?: ActiveQuoteStatus;
	/** @deprecated Legacy alias: true → starred, false → inbox. */
	starred?: boolean;
	sent?: boolean;
	author?: string;
	from?: string;
	to?: string;
	sort?: "newest" | "oldest" | "author" | "last_sent";
	cursor?: string;
	limit?: number;
}

export interface DuplicateScanParams {
	limit?: number;
}

export interface SearchParams {
	q: string;
	status?: ActiveQuoteStatus;
	starred?: boolean;
	sent?: boolean;
	author?: string;
	from?: string;
	to?: string;
	limit?: number;
}

export const api = {
	me: () => apiFetch<AuthMe>("/api/auth/me"),
	login: (input: LoginRequest) =>
		apiFetch<AuthMe>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
	logout: () => apiFetch<void>("/api/auth/logout", { method: "POST" }),

	listQuotes: (params: QuoteListParams = {}, signal?: AbortSignal) =>
		apiFetch<QuoteListResponse>(`/api/quotes${queryString(params)}`, { signal }),
	getQuote: (id: number) => apiFetch<Quote>(`/api/quotes/${id}`),
	createQuote: (input: CreateQuoteInput) =>
		apiFetch<Quote>("/api/quotes", { method: "POST", body: JSON.stringify(input) }),
	updateQuote: (id: number, input: UpdateQuoteInput) =>
		apiFetch<Quote>(`/api/quotes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
	deleteQuote: (id: number) => apiFetch<void>(`/api/quotes/${id}`, { method: "DELETE" }),
	deleteQuotes: (ids: number[], source: "duplicates" | "bulk" = "bulk") =>
		apiFetch<BulkDeleteQuotesResponse>("/api/quotes/bulk-delete", {
			method: "POST",
			body: JSON.stringify({ ids, source }),
		}),
	dropped: (params: { q?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
		apiFetch<QuoteListResponse>(`/api/dropped${queryString(params)}`, { signal }),
	restoreDropped: (id: number, status: ActiveQuoteStatus) =>
		apiFetch<Quote>(`/api/dropped/${id}/restore`, {
			method: "POST",
			body: JSON.stringify({ status }),
		}),
	deleteDropped: (id: number) => apiFetch<void>(`/api/dropped/${id}`, { method: "DELETE" }),
	similarQuotes: (id: number, limit = 5) =>
		apiFetch<DuplicateMatch[]>(`/api/quotes/${id}/similar?limit=${limit}`),
	search: (params: SearchParams, signal?: AbortSignal) =>
		apiFetch<SearchResponse>(`/api/search${queryString(params)}`, { signal }),
	scanDuplicates: (params: DuplicateScanParams = {}, signal?: AbortSignal) =>
		apiFetch<DuplicateScanResponse>(`/api/duplicates${queryString(params)}`, {
			...(signal ? { signal } : {}),
		}),
	ignoreDuplicateGroup: (key: string, ignored: boolean) =>
		apiFetch<DuplicateIgnoreResponse>("/api/duplicates/ignore", {
			method: "POST",
			body: JSON.stringify({ key, ignored }),
		}),
	checkDuplicates: (input: DuplicateCheckInput, signal?: AbortSignal) =>
		apiFetch<DuplicateCheckResponse>("/api/duplicates/check", {
			method: "POST",
			body: JSON.stringify(input),
			...(signal ? { signal } : {}),
		}),

	daily: () => apiFetch<DailyResponse>("/api/daily"),
	dailyPreview: (date?: string) =>
		apiFetch<DailyBatch>(`/api/daily/preview${queryString({ date })}`),
	commitDaily: (channel = "api") =>
		apiFetch<{ batch: DailyBatch; alreadyExisted: boolean }>("/api/daily", {
			method: "POST",
			body: JSON.stringify({ channel }),
		}),
	sendDaily: () =>
		apiFetch<DailySendResponse>("/api/daily/send", {
			method: "POST",
		}),
	settings: () => apiFetch<Settings>("/api/settings"),
	deliveries: (
		params: {
			cursor?: string;
			limit?: number;
			channel?: string;
			starred?: boolean;
			from?: string;
			to?: string;
		} = {},
	) => apiFetch<DeliveryListResponse>(`/api/deliveries${queryString(params)}`),

	stats: () => apiFetch<Stats>("/api/stats"),
	indexStatus: () => apiFetch<IndexStatus>("/api/admin/index/status"),
	reindex: (force = false) =>
		apiFetch<IndexStatus>("/api/admin/index/reindex", {
			method: "POST",
			body: JSON.stringify({ force }),
		}),

	importCommit: (input: ImportCommitInput) =>
		apiFetch<ImportReport>("/api/import", {
			method: "POST",
			body: JSON.stringify(input),
		}),

	downloadQuotes: async (format: "json" | "csv", params: QuoteListParams = {}) => {
		const stamp = new Date().toISOString().slice(0, 10);
		await download(
			`/api/quotes/export${queryString({ ...params, format })}`,
			`quotan-${stamp}.${format}`,
		);
	},
	downloadBackup: async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		await download("/api/admin/backup", `quotan-backup-${stamp}.sqlite`);
	},
};
