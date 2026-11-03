import type { Quote } from "@quotan/shared";
import type { TelegramConfig } from "../config.js";
import { ApiError } from "../lib/errors.js";

const MAX_QUOTE_CHARS = 1800;
const REQUEST_TIMEOUT_MS = 10_000;

export function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncateQuote(text: string, max = MAX_QUOTE_CHARS): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function quoteBlock(quote: Quote): string {
	return `“${escapeHtml(truncateQuote(quote.text))}” — ${escapeHtml(quote.author)}`;
}

export interface DailyMessageInput {
	date: string;
	starred: Quote | null;
	unstarred: Quote | null;
	publicOrigin: string;
}

/** The one daily Telegram message. Outbound only; no commands or callbacks. */
export function formatDailyMessage(input: DailyMessageInput): string {
	const lines = [`📌 <b>Daily quotes — ${input.date}</b>`];
	if (input.starred) {
		lines.push("", "⭐ <b>Starred</b>", quoteBlock(input.starred));
	}
	if (input.unstarred) {
		lines.push("", "📥 <b>Inbox</b>", quoteBlock(input.unstarred));
	}
	if (!input.starred) lines.push("", "⚠️ No Starred quote was available today.");
	if (!input.unstarred) lines.push("", "⚠️ No Inbox quote was available today.");
	lines.push(
		"",
		"Open Quotan to keep or change today’s Inbox quote:",
		`${escapeHtml(input.publicOrigin)}/today`,
	);
	return lines.join("\n");
}

interface TelegramResponse {
	ok: boolean;
	description?: string;
	result?: { message_id?: number };
}

/** Never let the bot token leak through fetch errors or API responses. */
function sanitize(message: string, token: string): string {
	return message.split(token).join("<redacted>").slice(0, 300);
}

export class TelegramService {
	constructor(private readonly config: TelegramConfig) {}

	get enabled(): boolean {
		return this.config.enabled && this.config.configured;
	}

	get chatIdMasked(): string | null {
		return this.config.chatIdMasked;
	}

	async sendMessage(html: string): Promise<number | null> {
		const token = this.config.botToken;
		const chatId = this.config.chatId;
		if (!token || !chatId) {
			throw new ApiError(400, "TELEGRAM_NOT_CONFIGURED", "Telegram is not configured");
		}
		const url = `${this.config.apiBase}/bot${token}/sendMessage`;
		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text: html,
					parse_mode: "HTML",
					disable_web_page_preview: true,
				}),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Network error";
			throw new ApiError(
				502,
				"TELEGRAM_SEND_FAILED",
				`Telegram send failed: ${sanitize(message, token)}`,
			);
		}

		let payload: TelegramResponse | null = null;
		try {
			payload = (await response.json()) as TelegramResponse;
		} catch {
			payload = null;
		}
		if (!response.ok || !payload?.ok) {
			const description = payload?.description ?? `HTTP ${response.status}`;
			throw new ApiError(
				502,
				"TELEGRAM_SEND_FAILED",
				`Telegram send failed: ${sanitize(description, token)}`,
			);
		}
		const messageId = payload.result?.message_id;
		return typeof messageId === "number" ? messageId : null;
	}
}
