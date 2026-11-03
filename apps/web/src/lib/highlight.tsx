import type { ReactNode } from "react";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightText(text: string, query: string | undefined): ReactNode {
	if (!query?.trim()) return text;
	const tokens = query
		.trim()
		.split(/\s+/u)
		.map((token) => token.replace(/^["'“”]+|["'“”]+$/gu, ""))
		.filter((token) => token.length >= 2)
		.slice(0, 8);
	if (tokens.length === 0) return text;
	const tokenSet = new Set(tokens.map((token) => token.toLowerCase()));
	const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "giu");
	const parts = text.split(pattern);
	let marker = 0;
	return parts.map((part) => {
		if (!tokenSet.has(part.toLowerCase())) return part;
		marker += 1;
		return <mark key={`mark-${marker}-${part}`}>{part}</mark>;
	});
}
