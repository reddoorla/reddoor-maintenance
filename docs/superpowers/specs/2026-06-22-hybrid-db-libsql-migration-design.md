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

New modules under **`src/db/`** provide libSQL-backed equivalents with the **same return shapes** (`SubmissionRow`, `ScreenOutTotals`), taking a libSQL client instead of `AirtableBase`. The Netlify handlers (`form-ingest.mts`, `submission-status.mts`, `site-dashboard.mts`, `fleet-homepage.mts`) and the CLI swap `openBase`→`openDb` and the import source; the deps' _shapes_ are unchanged, so `ingest.ts`, `submission-status.ts`, the render code, and their tests are untouched in interface.

```
src/db/
  client.ts      openDb() → @libsql/client (env: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN; or file: for dev/CI/test)
  schema.ts      table definitions + migrations (see "Schema management")
  submissions.ts createSubmission/listNewSubmissions/listSubmissionsForSite/getSubmissionById/setStatus/stampNotified (libSQL)
  screenouts.ts  recordScreenOut/recordMarkedSpam/listScreenOutsSince (libSQL, EXACT atomic counters)
  backfill.ts    one-off Airtable → libSQL copy + reconciliation
```

## Schema (standard SQL)

**`submissions`** — mirrors `SubmissionRow`:

- `id TEXT PRIMARY KEY` (keep the existing Airtable record id on backfill; new rows get a generated id, e.g. `sub_<ulid>`), `submission_id INTEGER` (display number; autoincrement, backfilled values preserved), `site_id TEXT NOT NULL` (the Airtable Websites record id — the app-level join key, see below), `form_type TEXT`, `name TEXT`, `email TEXT`, `phone TEXT`, `message TEXT`, `extra_fields TEXT` (JSON string, unchanged), `source_url TEXT`, `utm TEXT`, `submitted_at TEXT` (ISO), `status TEXT` (new|read|archived|spam), `notify_status TEXT`, `resend_message_id TEXT`.
- Indexes: `(site_id, submitted_at DESC)` for per-site newest-first; `(status)` for the new-queue. These make `listSubmissionsForSite`/`listNewSubmissions` indexed server-side queries — retiring the JS-confirm-window pattern and the 200-row fetch cap.

**`spam_screenouts`** — EXACT daily counters (no more approximation):

- `site_id TEXT NOT NULL`, `date TEXT NOT NULL` (YYYY-MM-DD), `honeypot INTEGER NOT NULL DEFAULT 0`, `too_fast INTEGER NOT NULL DEFAULT 0`, `marked_spam INTEGER NOT NULL DEFAULT 0`, `PRIMARY KEY (site_id, date)`.
- Atomic increment: `INSERT INTO spam_screenouts(site_id,date,honeypot) VALUES(?, ?, 1) ON CONFLICT(site_id,date) DO UPDATE SET honeypot = honeypot + 1`. This **kills the read-modify-write race and the sum-duplicate-buckets hack** — counts become exact. Bounded growth (one row per site/day), so no prune needed.
- Read: `SELECT site_id, SUM(honeypot), SUM(too_fast), SUM(marked_spam) FROM spam_screenouts WHERE date >= ? GROUP BY site_id` — server-side, indexed by the PK.

**Cross-store join:** `submissions.site_id` stores the **Airtable Websites record id** (same value `SubmissionRow.siteId` holds today). The dashboard already maps `siteId → WebsiteRow` from the Airtable-loaded website list, so the join stays app-level by that id string — no foreign key across stores, no schema coupling. Websites stays the source of truth in Airtable.

## Schema management

**Recommendation: a tiny in-repo SQL migration runner** — a `src/db/migrations/NNNN_*.sql` directory applied in order, tracked in a `_migrations` table, run by `openDb()` (or an explicit `reddoor-maint db:migrate`). Rationale: only 2 tables; this keeps the new-dependency footprint to just `@libsql/client` and stays portable (plain SQL). **Alternative for review:** Drizzle (`drizzle-orm` + `drizzle-kit`) for typed schema + generated migrations + end-to-end query types — stronger types under strict tsc, at the cost of a real ORM dependency + codegen step. _This is a decision to confirm in review_ (lean: start with the tiny runner + hand-written typed row mappers mirroring the current `mapRow`; adopt Drizzle later if the query surface grows).

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
- **No** Postgres/Drizzle lock-in — Drizzle is an optional, confirmable enhancement, not a requirement.

## Open decisions to confirm in review

1. **Schema tooling**: tiny SQL migration runner (recommended, minimal deps) vs Drizzle (typed, heavier).
2. **Dual-write soak**: brief dual-write to Airtable during cutover for rollback insurance — yes (safer) or clean flip (simpler)?
3. **Submission id scheme** for new rows: `sub_<ulid>` vs keep an integer autoincrement as the primary key (the spec assumes a stable string id with a separate display `submission_id`).
