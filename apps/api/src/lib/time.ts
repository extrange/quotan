export function nowIso(): string {
	return new Date().toISOString();
}

function partsFor(date: Date, timeZone: string): Record<string, string> {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(date);
	return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function localDateString(date: Date, timeZone: string): string {
	const parts = partsFor(date, timeZone);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localTimeString(date: Date, timeZone: string): string {
	const parts = partsFor(date, timeZone);
	return `${parts.hour}:${parts.minute}`;
}

export function monthKey(date: Date, timeZone: string): string {
	const parts = partsFor(date, timeZone);
	return `${parts.year}-${parts.month}`;
}

export function addDays(date: Date, days: number): Date {
	const copy = new Date(date);
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

export function dayKeyFromIso(iso: string, timeZone: string): string {
	return localDateString(new Date(iso), timeZone);
}

export function startOfUtcDay(date: Date): Date {
	const copy = new Date(date);
	copy.setUTCHours(0, 0, 0, 0);
	return copy;
}

export function isValidIsoDate(value: string): boolean {
	const date = new Date(value);
	return !Number.isNaN(date.getTime());
}

export function daysBetween(aIso: string, bIso: string): number {
	const a = new Date(aIso).getTime();
	const b = new Date(bIso).getTime();
	return Math.floor(Math.abs(b - a) / 86_400_000);
}
