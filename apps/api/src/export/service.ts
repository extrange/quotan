import type { ExportEnvelope, Quote } from "@quotan/shared";
import { EXPORT_VERSION } from "@quotan/shared";
import type { DatabaseHandle } from "../db/index.js";
import { mapQuoteRow, type QuoteFilters, quoteFilterSql, rowToQuote } from "../db/quotes.js";
import { nowIso } from "../lib/time.js";

const CSV_HEADER = [
	"id",
	"text",
	"author",
	"status",
	"created_at",
	"updated_at",
	"last_sent_at",
	"sent_count",
];

function csvCell(value: string | number | null): string {
	if (value === null) return "";
	const string = String(value);
	if (/[",\r\n]/.test(string)) return `"${string.replace(/"/g, '""')}"`;
	return string;
}

export class ExportService {
	constructor(private readonly handle: DatabaseHandle) {}

	quotes(filters: QuoteFilters): Quote[] {
		const filter = quoteFilterSql(filters);
		const rows = this.handle.sqlite
			.prepare(`SELECT q.* FROM quotes q ${filter.sql} ORDER BY q.created_at ASC, q.id ASC`)
			.all(...filter.params) as Array<Parameters<typeof mapQuoteRow>[0]>;
		return rows.map((row) => rowToQuote(mapQuoteRow(row)));
	}

	json(quotes: Quote[]): string {
		const envelope: ExportEnvelope = {
			version: EXPORT_VERSION,
			exportedAt: nowIso(),
			count: quotes.length,
			quotes,
		};
		return `${JSON.stringify(envelope, null, 2)}\n`;
	}

	csv(quotes: Quote[], bom = false): string {
		const lines = [CSV_HEADER.join(",")];
		for (const quote of quotes) {
			lines.push(
				[
					quote.id,
					csvCell(quote.text),
					csvCell(quote.author),
					quote.status,
					quote.createdAt,
					quote.updatedAt,
					quote.lastSentAt,
					quote.sentCount,
				].join(","),
			);
		}
		return `${bom ? "\ufeff" : ""}${lines.join("\r\n")}\r\n`;
	}
}
