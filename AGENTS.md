# AGENTS.md

## Commands

```bash
npm install
npm run build:shared          # required before API/web typecheck or dev
npm run dev                   # API on :3000 + Vite on :5173
npm run lint                  # Biome
npm run typecheck             # API + web + shared + scripts
npm test                      # API integration + web component tests
npm run test:e2e              # build + Playwright (needs Chromium)
npm run build                 # production build
```

The repository uses npm workspaces, not pnpm. Biome uses tabs and double quotes.

## Architecture

- Single Fastify 5 process serves `/api/*` and, in production, `apps/web/dist`.
- SQLite (WAL) via better-sqlite3; Drizzle defines tables but most repository queries are
  raw SQL. Migrations are in `apps/api/src/db/migrations.ts` and run on boot.
- `quotes_fts` is a regular FTS5 table kept in sync explicitly inside quote write
  transactions. Do not add SQLite triggers: better-sqlite3 has open issues combining FTS5
  triggers with transactions/RETURNING.
- Raw SQLite quote rows use snake_case. Always pass them through `mapQuoteRow()` before
  `rowToQuote()`; otherwise timestamps/metadata silently disappear from API responses.
- The vector index is an in-memory `Map<quoteId, Float32Array>` loaded from
  `quote_embeddings`; exact cosine search is intentional at this scale.
- Embeddings run in-process with Transformers.js (`@huggingface/transformers`) and a local
  ONNX model. The default is Granite small English R2 (384 dims, 8192-token context,
  CLS pooling) with a 16000-character cap; inputs over 8000 characters are embedded
  individually to avoid padding a whole batch. The model cache defaults to
  `<database dir>/models`; no embedding server or API key is involved.
- Embedding model fingerprint includes provider, model, dimensions, dtype, pooling, and
  prefixes. A change triggers a background reindex; vector search is disabled for a model
  change but keyword search remains.
- Library duplicate scans group exact/same-text quotes, merge strong near matches into
  clusters with a complete-linkage guard (every cross pair must clear the threshold), and
  keep weaker candidates as one review pair per quote. Ignored groups are persisted by stable
  group key in `duplicate_ignored_groups` and returned by the scan with `ignored: true`.
- Daily selection is deterministic per local date (hash of date + pool IDs), so a preview
  and the committed pair agree. `POST /api/daily` records manually and is idempotent per
  `local_date`. `POST /api/daily/send` sends through Telegram.
- The app itself sends one Telegram message per day. A scheduler checks every 30 seconds,
  catches up on boot, and retries failures after 5 minutes. Telegram is outbound only: no
  webhook, polling, commands, or inline buttons.
- A successful send records deliveries, updates sent counts, and auto-drops the Inbox quote
  (`drop_source='daily'`). A failed send leaves the batch pending and never auto-drops.
  Today hydrates the recorded pair even after that quote becomes Dropped.
- Every quote has exactly one `status`: `starred`, `inbox`, `private`, or `dropped`.
  `dropped` is a soft-delete archive: active queries exclude it, it is never sent, and it
  blocks exact re-imports. There is no `starred` column.
- Import commits are idempotent by client-supplied `batchId`. They skip exact duplicates of
  active or Dropped quotes (and within the batch), then leave near/semantic matches for the
  Duplicates tab.
- Cookie-authenticated mutations check `Origin` against `PUBLIC_ORIGIN` (and the forwarded
  request host). API-key requests are exempt.

## Conventions

- Shared DTOs/Zod schemas live in `packages/shared`; build it before using it.
- API routes accept either the session cookie or `Authorization: Bearer`/`X-API-Key`.
- Never send `API_KEY`, `TELEGRAM_BOT_TOKEN`, or other server secrets to the web client.
- Apply the active-query rule: normal lists, search, export, stats, daily selection,
  duplicates, FTS rebuilds, and embeddings exclude `status='dropped'`. Only the Dropped
  endpoints and daily-batch hydration may read archived rows.
- Run `npm run lint && npm run typecheck && npm test` before finishing a change.
- Pre-commit hooks are configured in `devenv.nix`; `.pre-commit-config.yaml` is generated
  and ignored.
