export class LruCache<V> {
	private readonly map = new Map<string, { value: V; expiresAt: number }>();

	constructor(
		private readonly maxEntries: number,
		private readonly ttlMs: number,
	) {}

	get(key: string): V | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt < Date.now()) {
			this.map.delete(key);
			return undefined;
		}
		// Refresh recency.
		this.map.delete(key);
		this.map.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
		while (this.map.size > this.maxEntries) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	clear(): void {
		this.map.clear();
	}
}
