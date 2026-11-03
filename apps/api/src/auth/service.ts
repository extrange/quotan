import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { nowIso } from "../lib/time.js";
import { hashPassword, verifyPassword } from "./password.js";

export const SESSION_COOKIE = "quotan_session";

export type AuthMethod = "session" | "apiKey";

export interface AuthContext {
	method: AuthMethod;
	token?: string;
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export class AuthService {
	private readonly passwordHash: string;
	private readonly apiKeyHash: string;
	private readonly ttlMs: number;

	constructor(
		private readonly config: AppConfig,
		private readonly sqlite: Database.Database,
	) {
		this.passwordHash =
			config.authPasswordHash ??
			hashPassword(config.authPassword ?? (config.isProduction ? "" : "quotan"));
		this.apiKeyHash = sha256(config.apiKey);
		this.ttlMs = config.sessionTtlDays * 86_400_000;
	}

	verifyPassword(password: string): boolean {
		return verifyPassword(password, this.passwordHash);
	}

	createSession(): { token: string; expiresAt: string } {
		const token = randomBytes(32).toString("base64url");
		const tokenHash = sha256(token);
		const createdAt = nowIso();
		const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
		this.sqlite
			.prepare(
				"INSERT INTO sessions(token_hash, created_at, expires_at, last_seen_at) VALUES(?, ?, ?, ?)",
			)
			.run(tokenHash, createdAt, expiresAt, createdAt);
		return { token, expiresAt };
	}

	getSession(token: string): { expiresAt: string } | null {
		const tokenHash = sha256(token);
		const row = this.sqlite
			.prepare("SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = ?")
			.get(tokenHash) as { expires_at: string; last_seen_at: string } | undefined;
		if (!row) return null;
		const now = Date.now();
		if (new Date(row.expires_at).getTime() <= now) {
			this.deleteSession(token);
			return null;
		}
		const lastSeen = new Date(row.last_seen_at).getTime();
		if (now - lastSeen > 3_600_000) {
			const expiresAt = new Date(now + this.ttlMs).toISOString();
			this.sqlite
				.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
				.run(new Date(now).toISOString(), expiresAt, tokenHash);
			return { expiresAt };
		}
		return { expiresAt: row.expires_at };
	}

	deleteSession(token: string): void {
		this.sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
	}

	cleanupExpired(): void {
		this.sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
	}

	checkApiKey(candidate: string | undefined): boolean {
		if (!candidate) return false;
		return safeEqual(sha256(candidate), this.apiKeyHash);
	}

	cookieOptions() {
		return {
			path: "/",
			httpOnly: true,
			sameSite: "lax" as const,
			secure: this.config.cookieSecure,
			maxAge: Math.floor(this.ttlMs / 1000),
		};
	}

	clearCookieOptions() {
		return {
			path: "/",
			httpOnly: true,
			sameSite: "lax" as const,
			secure: this.config.cookieSecure,
		};
	}
}
