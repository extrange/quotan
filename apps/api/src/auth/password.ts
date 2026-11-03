import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
	return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	try {
		const [scheme, nRaw, rRaw, pRaw, saltB64, hashB64] = stored.split("$");
		if (scheme !== "scrypt" || !nRaw || !rRaw || !pRaw || !saltB64 || !hashB64) return false;
		const salt = Buffer.from(saltB64, "base64");
		const expected = Buffer.from(hashB64, "base64");
		const actual = scryptSync(password, salt, expected.length, {
			N: Number(nRaw),
			r: Number(rRaw),
			p: Number(pRaw),
		});
		return actual.length === expected.length && timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}
