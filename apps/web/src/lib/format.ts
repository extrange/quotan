const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

export function formatDate(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dateTimeFormatter.format(date);
}

export function relativeTime(value: string | null | undefined): string {
	if (!value) return "never";
	const date = new Date(value);
	const diff = date.getTime() - Date.now();
	const abs = Math.abs(diff);
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		["year", 31_536_000_000],
		["month", 2_592_000_000],
		["week", 604_800_000],
		["day", 86_400_000],
		["hour", 3_600_000],
		["minute", 60_000],
	];
	const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	for (const [unit, ms] of units) {
		if (abs >= ms) return formatter.format(Math.round(diff / ms), unit);
	}
	return "just now";
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat().format(value);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function isoDay(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toISOString().slice(0, 10);
}

export function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1).trimEnd()}…`;
}
