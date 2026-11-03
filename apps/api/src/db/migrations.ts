export interface Migration {
	version: number;
	name: string;
	sql: string;
}

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "initial schema",
		sql: `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  author TEXT NOT NULL,
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  text_key TEXT NOT NULL,
  author_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  last_sent_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at, id);
CREATE INDEX IF NOT EXISTS idx_quotes_starred_created ON quotes(starred, created_at, id);
CREATE INDEX IF NOT EXISTS idx_quotes_last_sent ON quotes(last_sent_at, id);
CREATE INDEX IF NOT EXISTS idx_quotes_dedupe ON quotes(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_quotes_text_key ON quotes(text_key);
CREATE INDEX IF NOT EXISTS idx_quotes_author_key ON quotes(author_key);

CREATE VIRTUAL TABLE IF NOT EXISTS quotes_fts USING fts5(
  text,
  author,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS quote_embeddings (
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL,
  text_key TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (quote_id, model_key)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON quote_embeddings(model_key);

CREATE TABLE IF NOT EXISTS daily_batches (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  starred_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  unstarred_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_batches(local_date);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES daily_batches(id) ON DELETE CASCADE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  quote_text TEXT NOT NULL,
  quote_author TEXT NOT NULL,
  starred_snapshot INTEGER NOT NULL CHECK (starred_snapshot IN (0, 1)),
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_sent ON deliveries(sent_at, id);
CREATE INDEX IF NOT EXISTS idx_deliveries_quote ON deliveries(quote_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_channel ON deliveries(channel);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_batch_quote ON deliveries(batch_id, quote_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  stats_json TEXT NOT NULL
);
`,
	},
	{
		version: 2,
		name: "ignored duplicate groups",
		sql: `
CREATE TABLE IF NOT EXISTS duplicate_ignored_groups (
  group_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`,
	},
	{
		version: 3,
		name: "quote status, dropped archive, and daily send state",
		sql: `
ALTER TABLE quotes ADD COLUMN status TEXT NOT NULL DEFAULT 'inbox'
  CHECK (status IN ('starred', 'inbox', 'private', 'dropped'));

UPDATE quotes SET status = CASE WHEN starred = 1 THEN 'starred' ELSE 'inbox' END;

DROP INDEX IF EXISTS idx_quotes_starred_created;
ALTER TABLE quotes DROP COLUMN starred;

ALTER TABLE quotes ADD COLUMN dropped_at TEXT;
ALTER TABLE quotes ADD COLUMN drop_source TEXT
  CHECK (drop_source IN ('quote', 'duplicates', 'bulk', 'daily') OR drop_source IS NULL);

CREATE INDEX IF NOT EXISTS idx_quotes_status_last_sent ON quotes(status, last_sent_at, id);
CREATE INDEX IF NOT EXISTS idx_quotes_dropped_at ON quotes(dropped_at DESC, id DESC);

ALTER TABLE daily_batches ADD COLUMN send_state TEXT NOT NULL DEFAULT 'sent'
  CHECK (send_state IN ('pending', 'sent'));
ALTER TABLE daily_batches ADD COLUMN sent_at TEXT;
ALTER TABLE daily_batches ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE daily_batches ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_batches ADD COLUMN last_attempt_at TEXT;
ALTER TABLE daily_batches ADD COLUMN last_error TEXT;

UPDATE daily_batches SET sent_at = created_at WHERE sent_at IS NULL;
`,
	},
	{
		version: 4,
		name: "dropped from status",
		sql: `
ALTER TABLE quotes ADD COLUMN dropped_from TEXT
  CHECK (dropped_from IN ('starred', 'inbox', 'private') OR dropped_from IS NULL);
`,
	},
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
	(max, migration) => Math.max(max, migration.version),
	0,
);
