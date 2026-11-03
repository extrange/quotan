import type { DuplicateCategory } from "@quotan/shared";
import type { AppConfig } from "../config.js";
import type { QuoteRow } from "../db/schema.js";
import { hashString } from "../lib/normalize.js";

export const DUPLICATE_SEVERITY: Record<DuplicateCategory, number> = {
	exact: 0,
	same_text: 1,
	likely: 2,
	similar: 3,
};

export interface DuplicateEdge {
	/** Endpoints are stored in ascending id order so keys and tie-breaks are stable. */
	left: QuoteRow;
	right: QuoteRow;
	category: DuplicateCategory;
	similarity: number | null;
	trigram: number;
}

export interface DuplicateGroupRows {
	key: string;
	category: DuplicateCategory;
	rows: QuoteRow[];
	similarity: number | null;
	trigram: number;
}

interface Component {
	nodes: Set<number>;
	edges: DuplicateEdge[];
}

class UnionFind {
	private readonly parent = new Map<number, number>();
	private readonly sizes = new Map<number, number>();

	add(id: number): void {
		if (this.parent.has(id)) return;
		this.parent.set(id, id);
		this.sizes.set(id, 1);
	}

	find(id: number): number {
		if (!this.parent.has(id)) this.add(id);
		let root = id;
		while (this.parent.get(root) !== root) root = this.parent.get(root) as number;
		let current = id;
		while (current !== root) {
			const next = this.parent.get(current) as number;
			this.parent.set(current, root);
			current = next;
		}
		return root;
	}

	/** Merges two sets and returns the root that represents the result. */
	union(a: number, b: number): number {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA === rootB) return rootA;
		const sizeA = this.sizes.get(rootA) ?? 1;
		const sizeB = this.sizes.get(rootB) ?? 1;
		// Attach the larger set so repeated merges stay close to O(α(n)).
		const [keep, drop] = sizeA >= sizeB ? [rootA, rootB] : [rootB, rootA];
		this.parent.set(drop, keep);
		this.sizes.set(keep, sizeA + sizeB);
		return keep;
	}

	ids(): Iterable<number> {
		return this.parent.keys();
	}
}

/**
 * A pair only joins a cluster when the evidence is strong. When vectors exist
 * they decide: a low semantic score vetoes a high trigram score, because
 * numbered templates ("quote 10" / "quote 100") are textually close but
 * unrelated. Trigram is only a fallback for quotes without vectors.
 */
export function isMergeEdge(edge: DuplicateEdge, config: AppConfig): boolean {
	if (edge.category === "exact" || edge.category === "same_text") return true;
	if (edge.similarity !== null) return edge.similarity >= config.search.clusterSimilarity;
	return edge.trigram >= config.search.clusterTrigram;
}

/** Returns whether two quotes are close enough to share a cluster. */
export type PairCompatibility = (left: QuoteRow, right: QuoteRow) => boolean;

/**
 * Groups text-identical rows and strongly matched pairs into connected
 * components using complete linkage, then keeps remaining weak pairs as one
 * review card per quote. Each quote therefore appears in at most one group,
 * while the per-pair N² output is collapsed.
 */
export function buildDuplicateGroups(input: {
	rowsById: Map<number, QuoteRow>;
	textGroups: QuoteRow[][];
	edges: DuplicateEdge[];
	config: AppConfig;
	isPairCompatible: PairCompatibility;
}): DuplicateGroupRows[] {
	const { rowsById, textGroups, edges, config, isPairCompatible } = input;
	const uf = new UnionFind();
	const members = new Map<number, Set<number>>();

	const register = (id: number): void => {
		uf.add(id);
		if (!members.has(id)) members.set(id, new Set([id]));
	};

	const merge = (a: number, b: number, checkCompatibility: boolean): boolean => {
		const rootA = uf.find(a);
		const rootB = uf.find(b);
		if (rootA === rootB) return true;
		const leftMembers = members.get(rootA);
		const rightMembers = members.get(rootB);
		if (!leftMembers || !rightMembers) return false;

		if (checkCompatibility) {
			// Complete linkage: every cross pair must pass, not only the edge that
			// triggered the merge. This is what stops A~B~C with A!~C from merging.
			for (const leftId of leftMembers) {
				const left = rowsById.get(leftId);
				if (!left) continue;
				for (const rightId of rightMembers) {
					const right = rowsById.get(rightId);
					if (!right) continue;
					if (!isPairCompatible(left, right)) return false;
				}
			}
		}

		const keep = uf.union(rootA, rootB);
		const drop = keep === rootA ? rootB : rootA;
		const keepMembers = members.get(keep);
		const dropMembers = members.get(drop);
		if (keepMembers && dropMembers) {
			for (const id of dropMembers) keepMembers.add(id);
		}
		members.delete(drop);
		return true;
	};

	for (const rows of textGroups) {
		for (const row of rows) register(row.id);
	}
	const mergeEdges = edges
		.filter((edge) => isMergeEdge(edge, config))
		.sort(
			(a, b) =>
				(b.similarity ?? -1) - (a.similarity ?? -1) ||
				b.trigram - a.trigram ||
				DUPLICATE_SEVERITY[a.category] - DUPLICATE_SEVERITY[b.category] ||
				a.left.id - b.left.id ||
				a.right.id - b.right.id,
		);
	for (const edge of mergeEdges) {
		register(edge.left.id);
		register(edge.right.id);
	}

	// Text-identical rows are a hard must-link; they never need a similarity check.
	for (const rows of textGroups) {
		for (let index = 1; index < rows.length; index += 1) {
			merge(rows[0].id, rows[index].id, false);
		}
	}

	const acceptedEdges: DuplicateEdge[] = [];
	const rejectedEdges = new Set<DuplicateEdge>();
	for (const edge of mergeEdges) {
		if (merge(edge.left.id, edge.right.id, true)) acceptedEdges.push(edge);
		else rejectedEdges.add(edge);
	}

	const components = new Map<number, Component>();
	for (const id of uf.ids()) {
		const root = uf.find(id);
		let component = components.get(root);
		if (!component) {
			component = { nodes: new Set(), edges: [] };
			components.set(root, component);
		}
		component.nodes.add(id);
	}
	for (const edge of acceptedEdges) {
		components.get(uf.find(edge.left.id))?.edges.push(edge);
	}

	const groups: DuplicateGroupRows[] = [];
	const covered = new Set<number>();

	for (const component of components.values()) {
		if (component.nodes.size < 2) continue;
		const rows = [...component.nodes]
			.map((id) => rowsById.get(id))
			.filter((row): row is QuoteRow => Boolean(row))
			.sort((a, b) => a.id - b.id);
		if (rows.length < 2) continue;

		const textKeys = new Set(rows.map((row) => row.textKey));
		const dedupeKeys = new Set(rows.map((row) => row.dedupeKey));
		const category: DuplicateCategory =
			dedupeKeys.size === 1 ? "exact" : textKeys.size === 1 ? "same_text" : "likely";

		let similarity: number | null = null;
		for (const edge of component.edges) {
			if (edge.similarity === null) continue;
			similarity = similarity === null ? edge.similarity : Math.min(similarity, edge.similarity);
		}
		const trigram =
			component.edges.length > 0 ? Math.min(...component.edges.map((edge) => edge.trigram)) : 1;

		const minId = rows[0].id;
		const key =
			textKeys.size === 1
				? `text:${hashString(rows[0].textKey).slice(0, 16)}`
				: rows.length === 2
					? `pair:${rows[0].id}:${rows[1].id}`
					: `cluster:${minId}`;

		groups.push({ key, category, rows, similarity, trigram });
		for (const row of rows) covered.add(row.id);
	}

	const weakEdges = edges
		.filter((edge) => !isMergeEdge(edge, config) || rejectedEdges.has(edge))
		.sort(
			(a, b) =>
				DUPLICATE_SEVERITY[a.category] - DUPLICATE_SEVERITY[b.category] ||
				(b.similarity ?? -1) - (a.similarity ?? -1) ||
				b.trigram - a.trigram ||
				a.left.id - b.left.id ||
				a.right.id - b.right.id,
		);

	for (const edge of weakEdges) {
		if (covered.has(edge.left.id) || covered.has(edge.right.id)) continue;
		groups.push({
			key: `pair:${edge.left.id}:${edge.right.id}`,
			category: edge.category,
			rows: [edge.left, edge.right],
			similarity: edge.similarity,
			trigram: edge.trigram,
		});
		covered.add(edge.left.id);
		covered.add(edge.right.id);
	}

	return groups;
}
