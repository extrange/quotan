import { badRequest } from "./errors.js";

export function encodeCursor(value: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T {
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
		return parsed as T;
	} catch {
		throw badRequest("Invalid cursor");
	}
}
