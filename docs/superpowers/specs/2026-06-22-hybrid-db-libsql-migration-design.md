# Hybrid DB migration — Submissions + spam counters to libSQL — design

**Date:** 2026-06-22
**Status:** draft (pending user review)

## Problem & decision

Airtable is doing two jobs: a **human back office** (Websites/Reports/Digest — config + records the non-technical team edits in the grid/mobile app) and a **data store for high-volume machine data** (Submissions, spam screen-out counters). The second job is where every pain lives — the ~5 req/s per-base cap (we added a throttle), no atomic increment (spam counters degraded to _approximate_ daily buckets), no server-side aggregation (counts are full-table scans), a per-base row ceiling, and 200-row fetch caps.

**Decision (user-chosen):** move the **high-volume data** — **Submissions** and the **spam screen-out counters** — off Airtable to a **libSQL** SQL database, in **one migration ("all high-volume now")**. Keep **Websites, Reports, Digest State** in Airtable (the back office). This is the hybrid: Airtable for humans, SQL for volume.

**"Events":** the only high-volume event data that exists today _is_ the spam screen-outs. There is no other telemetry producer, so this migration does **not** invent a speculative events table — the spam counters are the events. (Per-event telemetry is a noted future option, below.)

## Engine: libSQL (Turso-hosted, portable)

`@libsql/client` (HTTP-per-statement → **no connection pool** to exhaust across Netlify's pool-less cold-start functions; the same client serves the GitHub Actions CLI and a **local file** for dev/CI/vitest). Chosen for: cleanest serverless driver, lowest ops (two secrets), best local-test story (real in-memory SQLite), and lowest lock-in.

**Not locked to Turso.** libSQL is open-source SQLite-lineage; the same client + SQL run against a **local file**, a **self-hosted `sqld`**, or **Turso-hosted**, and the data dumps to a plain `.sqlite` at any time. We host on Turso for zero-ops convenience but keep **standard SQL only** (no Turso-specific features) so the host is a connection-string swap. This portability is the insurance and a hard requirement of the design.

**Known constraint:** libSQL is single-writer (SQLite lineage). The bursty public ingest serializes through one writer — comfortable at 12→200 sites' volume. We keep the hot write path cheap (atomic upsert on a tiny counter table; one INSERT per submission). If a future high-fan-out telemetry source appears, re-evaluate vs Postgres/Neon (the runner-up) at that point.

## Architecture — the migration rides the existing DI seam

All DB access already flows through small dependency-injected functions, so the migration is an **implementation swap at the composition roots**, not a handler rewrite:

- `src/reports/airtable/submissions.ts` → `createSubmission`, `listNewSubmissions`, `listSubmissionsForSite`, `getSubmissionById`, `setSubmissionStatusRow`, `stampNotified` (all `(base, …)` today).
- `src/reports/airtable/screenouts.ts` → `recordScreenOut`, `recordMarkedSpam`, `listScreenOutsSince`.
- Handlers compose these into `IngestDeps` / `SubmissionStatusDeps` / `ScreenOutDeps` and the dashboard reads.

New modules under **`src/db/`** provide libSQL-backed equivalents with the **same return shapes** (`SubmissionRow`, `ScreenOutTotals`), taking a `Kysely<Database>` handle instead of `AirtableBase`. The Netlify handlers (`form-ingest.mts`, `submission-status.mts`, `site-dashboard.mts`, `fleet-homepage.mts`) and the CLI swap `openBase`→`openDb` and the import source; the deps' _shapes_ are unchanged, so `ingest.ts`, `submission-status.ts`, the render code, and their tests are untouched in interface.

```
src/db/
  client.ts      openDb() → Kysely<Database> over @libsql/kysely-libsql (env: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN; or file: for dev/CI/test); applies migrations on open
  schema.ts      the hand-written `Database` interface (one table type each) — the source Kysely types queries from
  migrations/    NNNN_*.sql — plain standard SQL, applied in order, tracked in a _migrations table
  migrate.ts     ~40-line runner that applies migrations/*.sql once per DB (NOT Kysely's DSL migrator — keeps SQL portable)
  submissions.ts createSubmission/listNewSubmissions/listSubmissionsForSite/getSubmissionById/setStatus/stampNotified (Kysely queries)
  screenouts.ts  recordScreenOut/recordMarkedSpam/listScreenOutsSince (Kysely; atomic upsert via the `sql` tag)
  backfill.ts    one-off Airtable → libSQL copy + reconciliation
```

## Schema (standard SQL)

**`submissions`** — mirrors `SubmissionRow`:

- `id TEXT PRIMARY KEY` (keep the existing Airtable record id on backfill; new rows get `"sub_" + crypto.randomUUID()` — no new dep), `submission_id INTEGER` (display number; autoincrement, backfilled values preserved), `site_id TEXT NOT NULL` (the Airtable Websites record id — the app-level join key, see below), `form_type TEXT`, `name TEXT`, `email TEXT`, `phone TEXT`, `message TEXT`, `extra_fields TEXT` (JSON string, unchanged), `source_url TEXT`, `utm TEXT`, `submitted_at TEXT` (ISO), `status TEXT` (new|read|archived|spam), `notify_status TEXT`, `resend_message_id TEXT`.
- Indexes: `(site_id, submitted_at DESC)` for per-site newest-first; `(status)` for the new-queue. These make `listSubmissionsForSite`/`listNewSubmissions` indexed server-side queries — retiring the JS-confirm-window pattern and the 200-row fetch cap.

**`spam_screenouts`** — EXACT daily counters (no more approximation):

- `site_id TEXT NOT NULL`, `date TEXT NOT NULL` (YYYY-MM-DD), `honeypot INTEGER NOT NULL DEFAULT 0`, `too_fast INTEGER NOT NULL DEFAULT 0`, `marked_spam INTEGER NOT NULL DEFAULT 0`, `PRIMARY KEY (site_id, date)`.
- Atomic increment: `INSERT INTO spam_screenouts(site_id,date,honeypot) VALUES(?, ?, 1) ON CONFLICT(site_id,date) DO UPDATE SET honeypot = honeypot + 1`. This **kills the read-modify-write race and the sum-duplicate-buckets hack** — counts become exact. Bounded growth (one row per site/day), so no prune needed.
- Read: `SELECT site_id, SUM(honeypot), SUM(too_fast), SUM(marked_spam) FROM spam_screenouts WHERE date >= ? GROUP BY site_id` — server-side, indexed by the PK.

**Cross-store join:** `submissions.site_id` stores the **Airtable Websites record id** (same value `SubmissionRow.siteId` holds today). The dashboard already maps `siteId → WebsiteRow` from the Airtable-loaded website list, so the join stays app-level by that id string — no foreign key across stores, no schema coupling. Websites stays the source of truth in Airtable.

## Schema management — Kysely queries + plain-SQL migrations

**Query layer: Kysely** (`kysely` + `@libsql/kysely-libsql`). A single hand-written `Database` interface in `schema.ts` types every SELECT result at compile time, deleting the per-column structural casts the Airtable `mapRow` does today (the win under `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`). The atomic counter upsert is written with Kysely's first-class parameterized `sql` template tag so it stays the exact standard SQL the schema specifies; the windowed `SUM … GROUP BY` uses the builder's `fn.sum()`. No codegen — CI stays `tsc && vitest && tsup`.

**Migrations: a tiny plain-SQL runner**, NOT Kysely's Migrator. `src/db/migrations/NNNN_*.sql` applied in order, tracked in a `_migrations` table, by `migrate.ts` (~40 lines), run on `openDb()`. Deliberately _not_ Kysely's schema-builder DSL — keeping migrations as standard `CREATE TABLE` SQL preserves the **host-swap portability hard-requirement** (no Kysely-specific migration coupling). YOU own the DDL.

**Runtime enum validators stay.** SQLite stores TEXT, so Kysely types the _shape_ not the _value domain_ — the existing `toFormType`/`toStatus`/`toNotifyStatus` narrowing helpers MUST be carried into the new read mappers verbatim to defend against bad stored data. (This is true under any tool; do not let the "the column is typed now" shortcut drop them.)

**Drift caveat (accepted):** the hand-written `Database` interface is not verified against the migration SQL by codegen (that's Drizzle's job, which we rejected as overkill for 2 tables). The mitigation is that every `src/db/*` function is unit-tested against a **real in-memory libSQL DB with the actual migrations applied**, so an interface/schema mismatch fails a test. The decision rule if the surface grows: this is already Kysely; the next step up (only if many tables/joins appear) would be Drizzle — not anticipated.

## Migration / cutover plan (one project, per-table gates)

Even as one migration, each table flips behind a verification gate — basic safety, not staging:

1. **Schema + client + repos** land first (libSQL-backed `src/db/*`, behind the same function shapes), fully unit-tested against in-memory libSQL. No handler is switched yet.
2. **Backfill** (`db:backfill`): read existing Airtable `Submissions` (paginated) and `Spam Screenouts` buckets via the current code, INSERT into libSQL. Counters are backfilled too so the trend we just started collecting carries over. Submission record ids preserved (so links/ids don't break).
3. **Reconcile**: assert libSQL row/aggregate counts match Airtable per site before flipping reads. A mismatch aborts the cutover.
4. **Flip composition roots**: point `form-ingest.mts` (writes + screen-out beacons), `submission-status.mts` (status + marked-spam), `site-dashboard.mts` + `fleet-homepage.mts` (reads) at the libSQL repos. Optional brief **dual-write** to Airtable during a soak for rollback insurance (flag to confirm).
5. **Soak + retire**: after a soak with reads served from libSQL, stop writing to the Airtable `Submissions` + `Spam Screenouts` tables and remove the Airtable-backed code paths. The Airtable tables can be archived/deleted later (out-of-band).

**The review surface:** Submissions are already listed + triaged in the dashboard (`render.ts` per-site list with new/read/archived/spam pills → `submission-status.ts`). Post-cutover the **dashboard is the canonical review surface**; the team stops using the Airtable Submissions table. Scope the finish explicitly as **parity with Airtable mobile triage** (the per-site page already renders on mobile) so it doesn't sprawl. (Notifications are unaffected — they go via Resend email, independent of storage.)

## Error handling

- **Ingest**: write the lead to libSQL **before** notify (same order as today); a notify/stamp failure stays swallowed+logged (never 502 a captured lead). If the libSQL write itself fails, the lead is lost and logged — the same failure class as an Airtable write failure today; acceptable.
- **Dashboard reads**: the screen-out + submissions reads stay wrapped in the existing defensive `try/catch` so a DB hiccup degrades (panel/strip absent) rather than blanking the page.
- **Beacon path**: unchanged on the site side; the central `recordScreenOut` is now an atomic upsert (a failure is still swallowed — a missed count must never error a screened bot).

## Security

- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` live in Netlify env + GitHub Actions secrets + `~/.config/reddoor-maint/credentials.env` — **never** in the repo or `.env`. (Two values, same shape as Airtable's PAT + base id.)
- The auth token is a write-capable credential; no public exposure (server-to-server only, like the Airtable PAT). Dashboard Basic auth + the ingest token are unchanged.

## Testing

- Unit-test every `src/db/*` function against **in-memory libSQL** (`:memory:` / a temp file) with the real schema applied — true SQL semantics, retiring the hand-rolled fake base (which had to "JS-confirm because the fake ignores filterByFormula") for the moved tables.
- Backfill + reconcile have their own tests (a seeded fake Airtable source → libSQL → assert parity).
- The existing handler/render/ingest/status tests are unchanged (the deps' shapes are identical); only the composition-root imports differ.

## Non-goals (YAGNI)

- **Not** moving Websites, Reports, or Digest State — they stay in Airtable (the human back office).
- **No** Turso-specific features (keep standard SQL → host portability).
- **No** speculative per-event telemetry table — exact daily counters suffice and stay bounded; per-event rows + rollup/prune is a documented future option only when a real analytics need appears.
- **No** new admin/CRUD tool — the existing dashboard is the review surface.
- **No** Postgres / Drizzle — evaluated and rejected as overkill for 2 tables (heavier deps + codegen, and it bypasses itself on our raw-SQL hot paths). Kysely is the chosen query layer; Drizzle stays on the shelf only if the schema ever multiplies into many tables/joins.

## Resolved decisions

1. **Engine**: libSQL via `@libsql/client`, Turso-hosted, standard-SQL-only for host portability (file / self-hosted `sqld` / `.sqlite` dump all reachable with the same code).
2. **Schema/query tooling**: **Kysely** (typed query results) + **plain `.sql` migrations via a tiny runner** (portability) + retained runtime enum validators. Drizzle rejected (overkill); pure raw-runner was runner-up.
3. **Cutover**: **brief dual-write soak** — libSQL is source of truth, Airtable writes are best-effort insurance, reads from libSQL; flip reads back with zero loss if needed, then retire.
4. **Submission id**: **opaque string PK** `"sub_" + crypto.randomUUID()` (no new dep); backfilled rows keep their Airtable record id so links resolve; `submission_id` integer is the display number.

## Implementation risks & required tests (from the tooling eval)

- **Atomic-upsert exactness must be proven**: a concurrency-flavored test — many `recordScreenOut` calls for the same (site, date) → the counter equals the call count. This is the whole point of the move; guard the `ON CONFLICT … DO UPDATE … + 1` clause.
- **Migration runner correctness**: a test that runs `migrate.ts` twice against `:memory:` and asserts no double-apply (ordering + idempotency); it gates every DB open.
- **Carry the enum validators verbatim** into the new mappers (`toFormType`/`toStatus`/`toNotifyStatus`) — the easiest thing to lose in the port, and a silent bad-data hole if dropped.
- **`.sql` files must ship to `dist` and resolve at runtime** in BOTH the published package and the Netlify function bundle (tsup won't bundle `.sql` — use the existing `import.meta.url` asset pattern). A missing migration fails the cold-start DB open; add a check that the files land in `dist`.
- **`Database` interface ↔ schema drift** is caught only by tests (no codegen) — every `src/db/*` function is unit-tested against a real in-memory libSQL DB with migrations applied; keep that coverage as queries change.
