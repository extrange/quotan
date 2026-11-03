# Import format

The import UI accepts CSV, JSON, or pasted text. Parsing happens in the browser; the API
receives normalized rows. Exact duplicates of active or Dropped quotes are skipped so the
same text cannot sneak back in through a routine import.

## CSV

At minimum, map one column to **Quote text**. The optional columns are **Author**,
**Status**, and **Created date**. Headers are auto-detected with common names:

| Field        | Example headers                                 |
| ------------ | ----------------------------------------------- |
| Quote text   | `quote`, `text`, `content`, `body`              |
| Author       | `author`, `by`, `attribution`                   |
| Status       | `status`, `state`, `starred`, `star`, `private` |
| Created date | `date`, `created`, `added`                      |

```csv
quote,author,status,created_at
"The unexamined life is not worth living.",Socrates,starred,2026-01-01
"Simplicity is the ultimate sophistication.",Leonardo da Vinci,inbox,
```

CSV quotation follows RFC 4180: wrap fields containing commas, quotes, or newlines in
double quotes and double internal quotes. UTF-8 is expected. A leading BOM is tolerated.

## JSON

Either a bare array or an export envelope works:

```json
{
	"version": 1,
	"exportedAt": "2026-10-31T12:00:00.000Z",
	"count": 1,
	"quotes": [
		{
			"text": "The unexamined life is not worth living.",
			"author": "Socrates",
			"status": "starred",
			"createdAt": "2026-01-01T00:00:00.000Z"
		}
	]
}
```

A legacy `starred` boolean is accepted in place of `status`. `quote`, `content`, and `by`
are accepted as aliases when importing a hand-written array; `created_at` is accepted as an
alias for `createdAt`. Exported `id`, `updatedAt`, `lastSentAt`, and `sentCount` are
ignored on import; use a SQLite backup to restore sent history.

## Paste

One quote per line. Separate the author with a tab, an em dash (`—`), an en dash (`–`), a
hyphen surrounded by spaces, or a pipe:

```
The unexamined life is not worth living. — Socrates
We are what we repeatedly do. | Aristotle
```

Pasted rows default to Inbox.

## Field values

- **Text** — required.
- **Author** — optional; defaults to `Unknown`.
- **Status** — `starred`, `inbox`, or `private`; defaults to `inbox`. Legacy values
  `true/1/yes/y/starred` map to Starred and `false/0/no/n/unstarred` map to Inbox.
  `dropped` is never accepted: Dropped is an archive, not an import target.
- **Created date** — ISO 8601, for example `2026-01-01` or `2026-01-01T00:00:00Z`. An
  invalid date falls back to the import time with a warning.
- `id`, `updatedAt`, `lastSentAt`, and `sentCount` are ignored. Import does not restore
  sent history; use a SQLite backup for that.

## Exact duplicate guard

Before inserting a row, the API normalizes the text and author and compares the dedupe key
against **every** quote, including Dropped. If a match exists, or the same row appeared
earlier in the batch, the row is skipped:

- `skippedDuplicates` — matched an active quote or an earlier row in this batch.
- `skippedDropped` — matched an archived (Dropped) quote.

The per-row report includes `duplicateOfId` and `duplicateOfStatus` so the UI can explain
what happened. Permanently deleting a Dropped quote is the only way to make its exact text
importable again.

## Near duplicates after import

The exact guard does not try to catch paraphrases. After importing, open the **Duplicates**
tab to scan for different-author, near-text, and semantic matches. Archiving from that
screen also moves quotes to Dropped, which blocks exact re-imports.

Rows with empty text are reported as invalid and skipped. An invalid `createdAt` falls
back to the import time with a warning; it does not abort the batch.
