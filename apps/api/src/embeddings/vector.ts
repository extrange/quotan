export function normalizeVector(vector: Float32Array): Float32Array {
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm);
	if (norm === 0) return vector;
	const normalised = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i += 1) {
		normalised[i] = (vector[i] ?? 0) / norm;
	}
	return normalised;
}

export function vectorToBuffer(vector: Float32Array): Buffer {
	return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToVector(buffer: Buffer): Float32Array {
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

export interface VectorSearchResult {
	id: number;
	score: number;
}

export class VectorStore {
	private readonly vectors = new Map<number, Float32Array>();
	readonly dimensions: number;
	modelKey: string | null;

	constructor(dimensions: number, modelKey: string | null) {
		this.dimensions = dimensions;
		this.modelKey = modelKey;
	}

	get size(): number {
		return this.vectors.size;
	}

	clear(): void {
		this.vectors.clear();
	}

	load(entries: Array<{ id: number; vector: Float32Array }>): void {
		this.vectors.clear();
		for (const entry of entries) {
			if (entry.vector.length !== this.dimensions) continue;
			this.vectors.set(entry.id, normalizeVector(entry.vector));
		}
	}

	upsert(id: number, vector: Float32Array): void {
		if (vector.length !== this.dimensions) return;
		this.vectors.set(id, normalizeVector(vector));
	}

	remove(id: number): void {
		this.vectors.delete(id);
	}

	get(id: number): Float32Array | undefined {
		return this.vectors.get(id);
	}

	search(query: Float32Array, allowedIds?: Set<number>, topK = 100): VectorSearchResult[] {
		if (query.length !== this.dimensions || this.vectors.size === 0) return [];
		const normalisedQuery = normalizeVector(query);
		const results: VectorSearchResult[] = [];
		for (const [id, vector] of this.vectors) {
			if (allowedIds && !allowedIds.has(id)) continue;
			let score = 0;
			for (let i = 0; i < vector.length; i += 1) {
				score += (vector[i] ?? 0) * (normalisedQuery[i] ?? 0);
			}
			results.push({ id, score });
		}
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}
}
