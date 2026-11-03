import { createHash } from "node:crypto";

const QUOTE_MAP: Record<string, string> = {
	"\u2018": "'",
	"\u2019": "'",
	"\u201a": "'",
	"\u201b": "'",
	"\u2032": "'",
	"\u02bc": "'",
	"\u201c": '"',
	"\u201d": '"',
	"\u201e": '"',
	"\u201f": '"',
	"\u2033": '"',
	"\u00ab": '"',
	"\u00bb": '"',
};

const DASH_MAP: Record<string, string> = {
	"\u2010": "-",
	"\u2011": "-",
	"\u2012": "-",
	"\u2013": "-",
	"\u2014": "-",
	"\u2015": "-",
	"\u2212": "-",
};

function replaceMap(value: string, map: Record<string, string>): string {
	return value.replace(/[\s\S]/gu, (char) => map[char] ?? char);
}

/** Normalise presentation characters without discarding meaningful punctuation. */
export function baseNormalize(input: string): string {
	let value = input.normalize("NFKC");
	value = replaceMap(value, QUOTE_MAP);
	value = replaceMap(value, DASH_MAP);
	value = value.replace(/[\u200b-\u200d\ufeff]/g, "");
	value = value.replace(/[\u00a0\u2007\u202f]/g, " ");
	return value.replace(/\s+/gu, " ").trim();
}

function stripWrappingQuotes(value: string): string {
	let current = value;
	for (let i = 0; i < 3; i += 1) {
		const match = current.match(/^["'](.+)["']$/su);
		if (!match?.[1]) break;
		current = match[1].trim();
	}
	return current;
}

/** Key used for exact-duplicate detection. Case, whitespace and sentence punctuation are ignored. */
export function normalizeTextKey(text: string): string {
	let value = baseNormalize(text).toLowerCase();
	value = stripWrappingQuotes(value);
	value = value.replace(/[.!?\u2026]+$/u, "").trim();
	return value;
}

export function normalizeAuthorKey(author: string): string {
	let value = baseNormalize(author).toLowerCase();
	value = value.replace(/^by\s+/u, "");
	value = value.replace(/[.,;:]+$/u, "").trim();
	return value;
}

export function hashString(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function dedupeKeyFor(text: string, author: string): string {
	return hashString(`${normalizeTextKey(text)}\u001f${normalizeAuthorKey(author)}`);
}

export function quoteKeys(text: string, author: string) {
	return {
		textKey: normalizeTextKey(text),
		authorKey: normalizeAuthorKey(author),
		dedupeKey: dedupeKeyFor(text, author),
	};
}

/** Character trigram Dice coefficient in [0, 1]. */
export function trigramDice(a: string, b: string): number {
	if (a === b) return 1;
	if (!a || !b) return 0;
	if (a.length < 3 || b.length < 3) return 0;

	const left = new Set<string>();
	const right = new Set<string>();
	for (let i = 0; i <= a.length - 3; i += 1) left.add(a.slice(i, i + 3));
	for (let i = 0; i <= b.length - 3; i += 1) right.add(b.slice(i, i + 3));
	if (left.size === 0 || right.size === 0) return 0;

	let intersection = 0;
	for (const gram of left) {
		if (right.has(gram)) intersection += 1;
	}
	return (2 * intersection) / (left.size + right.size);
}

/** Extract safe FTS query tokens from arbitrary user input. */
export function queryTokens(query: string, maxTokens = 20): string[] {
	const normalised = baseNormalize(query).toLowerCase();
	const matches = normalised.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) ?? [];
	const tokens: string[] = [];
	for (const match of matches) {
		const token = match.slice(0, 64);
		if (token.length === 0) continue;
		if (!tokens.includes(token)) tokens.push(token);
		if (tokens.length >= maxTokens) break;
	}
	return tokens;
}

export function ftsAndExpression(tokens: string[]): string | null {
	if (tokens.length === 0) return null;
	return tokens
		.map((token, index) => {
			const escaped = token.replace(/"/g, '""');
			if (index === tokens.length - 1 && /[\p{L}\p{N}]$/u.test(token)) {
				return `"${escaped}"*`;
			}
			return `"${escaped}"`;
		})
		.join(" AND ");
}

export function ftsOrExpression(tokens: string[]): string | null {
	if (tokens.length === 0) return null;
	return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}
