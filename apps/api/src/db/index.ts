import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./migrations.js";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
	sqlite: Database.Database;
	db: Db;
	path: string;
	close: () => void;
}

function isMemory(path: string): boolean {
	return path === ":memory:" || path.startsWith("file::memory:");
}

function readUserVersion(sqlite: Database.Database): number {
	const value = sqlite.pragma("user_version", { simple: true });
	return typeof value === "number" ? value : Number(value ?? 0);
}

function migrate(sqlite: Database.Database): void {
	const current = readUserVersion(sqlite);
	const pending = MIGRATIONS.filter((migration) => migration.version > current);
	if (pending.length === 0) return;

	sqlite.transaction(() => {
		for (const migration of pending) {
			sqlite.exec(migration.sql);
			sqlite.pragma(`user_version = ${migration.version}`);
		}
	})();
}

export function openDatabase(path: string): DatabaseHandle {
	if (!isMemory(path)) {
		mkdirSync(dirname(path), { recursive: true });
		if (existsSync(path)) {
			// Make a best-effort checkpoint before copying so the backup includes WAL data.
			let probe: Database.Database | undefined;
			try {
				probe = new Database(path);
				const version = readUserVersion(probe);
				if (version < LATEST_SCHEMA_VERSION) {
					probe.pragma("wal_checkpoint(TRUNCATE)");
					probe.close();
					probe = undefined;
					const backupPath = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
					copyFileSync(path, backupPath);
				}
			} finally {
				probe?.close();
			}
		}
	}

	const sqlite = new Database(path);
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("temp_store = MEMORY");
	migrate(sqlite);

	const db = drizzle(sqlite, { schema });
	return {
		sqlite,
		db,
		path,
		close: () => {
			try {
				sqlite.pragma("wal_checkpoint(TRUNCATE)");
			} finally {
				sqlite.close();
			}
		},
	};
}

export function getMeta(sqlite: Database.Database, key: string): string | null {
	const row = sqlite.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function setMeta(sqlite: Database.Database, key: string, value: string | null): void {
	if (value === null) {
		sqlite.prepare("DELETE FROM app_meta WHERE key = ?").run(key);
		return;
	}
	sqlite
		.prepare(
			"INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}

export function ftsInsert(
	sqlite: Database.Database,
	id: number,
	text: string,
	author: string,
): void {
	sqlite
		.prepare("INSERT INTO quotes_fts(rowid, text, author) VALUES(?, ?, ?)")
		.run(id, text, author);
}

export function ftsDelete(sqlite: Database.Database, id: number): void {
	sqlite.prepare("DELETE FROM quotes_fts WHERE rowid = ?").run(id);
}

export function rebuildFts(sqlite: Database.Database): void {
	sqlite.transaction(() => {
		sqlite.prepare("DELETE FROM quotes_fts").run();
		sqlite
			.prepare(
				"INSERT INTO quotes_fts(rowid, text, author) SELECT id, text, author FROM quotes WHERE status != 'dropped'",
			)
			.run();
	})();
}
