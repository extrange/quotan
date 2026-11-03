import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";

export async function createBackup(sqlite: Database.Database): Promise<{
	buffer: Buffer;
	filename: string;
}> {
	const path = join(tmpdir(), `quotan-backup-${randomUUID()}.sqlite`);
	try {
		await sqlite.backup(path);
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		return {
			buffer: readFileSync(path),
			filename: `quotan-backup-${stamp}.sqlite`,
		};
	} finally {
		try {
			unlinkSync(path);
		} catch {
			// The temp file may already be gone.
		}
	}
}
