import type { ActiveQuoteStatus } from "@quotan/shared";
import type { QuoteFilters } from "../db/quotes.js";
import { validateDateRange } from "../db/quotes.js";
import { badRequest } from "./errors.js";

type Query = Record<string, string | string[] | undefined>;

export function queryValue(query: Query, key: string): string | undefined {
	const value = query[key];
	return Array.isArray(value) ? value[0] : value;
}

export function parseBooleanValue(value: string | undefined, name: string): boolean | undefined {
	if (value === undefined || value === "") return undefined;
	if (["true", "1", "yes"].includes(value.toLowerCase())) return true;
	if (["false", "0", "no"].includes(value.toLowerCase())) return false;
	throw badRequest(`Invalid boolean for '${name}'`);
}

export function parseActiveStatus(value: string | undefined): ActiveQuoteStatus | undefined {
	if (value === undefined || value === "") return undefined;
	if (value === "starred" || value === "inbox" || value === "private") return value;
	throw badRequest("'status' must be starred, inbox, or private");
}

export function parseLimit(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > 100) {
		throw badRequest("'limit' must be an integer between 1 and 100");
	}
	return number;
}

export type ActiveQuoteFilters = Omit<QuoteFilters, "status"> & {
	status?: ActiveQuoteStatus;
};

export function parseFilters(query: Query): ActiveQuoteFilters {
	// `starred` remains a deprecated input alias: true → Starred, false → Inbox.
	const legacyStarred = parseBooleanValue(queryValue(query, "starred"), "starred");
	const status =
		parseActiveStatus(queryValue(query, "status")) ??
		(legacyStarred === undefined ? undefined : legacyStarred ? "starred" : "inbox");
	const filters: ActiveQuoteFilters = {
		status,
		sent: parseBooleanValue(queryValue(query, "sent"), "sent"),
		author: queryValue(query, "author"),
		from: queryValue(query, "from"),
		to: queryValue(query, "to"),
	};
	validateDateRange(filters.from, filters.to);
	return filters;
}

export function parseSort(value: string | undefined): "newest" | "oldest" | "author" | "last_sent" {
	if (!value) return "newest";
	if (["newest", "oldest", "author", "last_sent"].includes(value)) {
		return value as "newest" | "oldest" | "author" | "last_sent";
	}
	throw badRequest("Invalid sort");
}
