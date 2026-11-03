import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import type { QuoteRow } from "../db/schema.js";
import {
	buildDuplicateGroups,
	type DuplicateEdge,
	isMergeEdge,
	type PairCompatibility,
} from "./cluster.js";

const config = loadConfig({
	NODE_ENV: "test",
	EMBEDDING_PROVIDER: "none",
} as NodeJS.ProcessEnv);

function edge(
	overrides: Pick<DuplicateEdge, "category" | "similarity" | "trigram">,
): DuplicateEdge {
	return {
		left: { id: 1 } as QuoteRow,
		right: { id: 2 } as QuoteRow,
		...overrides,
	};
}

describe("isMergeEdge", () => {
	it("always merges exact and same-text groups", () => {
		expect(isMergeEdge(edge({ category: "exact", similarity: null, trigram: 1 }), config)).toBe(
			true,
		);
		expect(isMergeEdge(edge({ category: "same_text", similarity: null, trigram: 1 }), config)).toBe(
			true,
		);
	});

	it("lets vectors veto a text-only match", () => {
		// "quote 10" and "quote 100" are textually close but semantically unrelated.
		expect(isMergeEdge(edge({ category: "likely", similarity: 0.2, trigram: 0.99 }), config)).toBe(
			false,
		);
		expect(isMergeEdge(edge({ category: "likely", similarity: 0.89, trigram: 0.96 }), config)).toBe(
			false,
		);
		expect(isMergeEdge(edge({ category: "similar", similarity: 0.85, trigram: 0.8 }), config)).toBe(
			false,
		);
	});

	it("merges semantically close pairs and falls back to text without vectors", () => {
		expect(isMergeEdge(edge({ category: "likely", similarity: 0.9, trigram: 0.5 }), config)).toBe(
			true,
		);
		expect(isMergeEdge(edge({ category: "similar", similarity: 0.95, trigram: 0.2 }), config)).toBe(
			true,
		);
		expect(isMergeEdge(edge({ category: "likely", similarity: null, trigram: 0.98 }), config)).toBe(
			true,
		);
		expect(isMergeEdge(edge({ category: "likely", similarity: null, trigram: 0.97 }), config)).toBe(
			false,
		);
	});
});

function row(id: number, textKey: string): QuoteRow {
	return { id, textKey, dedupeKey: textKey, text: textKey, author: "" } as QuoteRow;
}

function pair(left: QuoteRow, right: QuoteRow, similarity: number): DuplicateEdge {
	return { left, right, category: "likely", similarity, trigram: 0.5 };
}

describe("buildDuplicateGroups complete linkage", () => {
	const a = row(1, "quote a");
	const b = row(2, "quote b");
	const c = row(3, "quote c");
	const rowsById = new Map([
		[a.id, a],
		[b.id, b],
		[c.id, c],
	]);
	const edges = [pair(a, b, 0.95), pair(b, c, 0.94)];

	function compatibleExcept(...blocked: Array<[number, number]>): PairCompatibility {
		const blockedKeys = new Set(blocked.map(([left, right]) => `${left}:${right}`));
		return (left, right) => !blockedKeys.has(`${left.id}:${right.id}`);
	}

	it("refuses a merge when any cross pair fails", () => {
		const groups = buildDuplicateGroups({
			rowsById,
			textGroups: [],
			edges,
			config,
			isPairCompatible: compatibleExcept([a.id, c.id]),
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]?.rows.map((quote) => quote.id)).toEqual([a.id, b.id]);
	});

	it("merges the whole set when every cross pair passes", () => {
		const groups = buildDuplicateGroups({
			rowsById,
			textGroups: [],
			edges,
			config,
			isPairCompatible: () => true,
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]?.rows.map((quote) => quote.id)).toEqual([a.id, b.id, c.id]);
	});
});
