# Airtable → Turso migration: implementation plan

Design: [`specs/2026-08-17-airtable-to-turso-migration-design.md`](../specs/2026-08-17-airtable-to-turso-migration-design.md)
Scheduled: weekend of 2026-08-22
Status: not started

Read the design first. It records the four decisions and the verified baseline;
this file is only the ordering and the checks.

## Before you start

The Airtable quota was raised on 2026-08-17, so nothing here is urgent and the
API is available throughout. That removes the original forcing function — do not
let phase 1 get rushed on the theory that something is on fire.

Fresh CSV exports are on the Desktop as of 2026-08-17 (`Websites-All Data.csv`,
`Reports-Grid view.csv`, plus Submissions / Spam Screenouts / Digest State).
Re-export if more than a few days have passed. Export from an **All Data**-style
view, not a filtered grid — verified lossless on 2026-08-17 (44/44 and 12/12
rows, every API-populated field present).

## Phase 0 — persist before enrich (independent, ship anytime)

Not part of the migration. Worth doing first because it is small and it removes
a live failure mode.

1. Reorder `ingestSubmission` (`src/forms/ingest.ts`) so `createSubmission`
   runs **before** `getWebsiteBySlug`, with site resolution as enrichment.
2. Decide what a submission with an unresolved site looks like — a row with a
   null/pending `site_id` and a reconcile path, or a dead-letter table.
3. Test: with `getWebsiteBySlug` throwing, the row still exists and the handler
   does not 502.

Today the lookup precedes the write, so a datastore failure returns 502 via
`src/dashboard/handler-helpers.ts:41-43` and the lead is gone with no record.
That is what made the 2026-08-17 outage unmeasurable after the fact.

## Phase 1 — foundation

**1.1 Derive the writer map.** For each of the 113 `Websites` columns, record its
single writer (cron / operator / derived / nobody) from the CSV header plus a
grep of `src/`. This is the deliverable that makes the three-table split real —
the design marks the split **provisional** until it exists. Do not skip it.

**1.2 Schema + migrations.** `sites`, `site_health`, `site_schedule`, `reports`
in `src/db/migrations.ts`, following the existing forward-only pattern. PKs are
the Airtable `rec…` ids (design D1). Drop only the six columns named in D4.

**1.3 CSV importer.** A CLI subcommand under `src/cli/commands/db.ts` (which
today accepts only `migrate`). Idempotent — re-running must converge, not
duplicate.

**1.4 Parity harness.** Reads both stores, diffs field-by-field, prints a
per-table mismatch report.

**1.5 Nightly backup, with a rehearsed restore.** `turso db dump` to an
encrypted GitHub Actions artifact, plus a restore into a scratch DB that is
actually executed once. Hard precondition for phases 2+ — do not move client
leads and report history onto a store with no proven restore.

**Gate:** the parity harness passes green on the pre-cutover state, where both
stores genuinely agree. Until it has passed once, any mismatch it reports is
suspect rather than evidence.

## Phase 2 — readers

Repoint, one surface at a time, verifying each against the parity harness:
cockpit → `site_health`; site detail → `sites`; form ingest → `sites`.

Ship the site-detail editor extension **early in this phase**. Between the
import and the console build-out, fields the editor does not cover are only
reachable via SQL, and the shorter that window is the better.

## Phase 3 — writers

Repoint and delete the per-site loops as you go:

- `src/audits/write-audits-to-airtable.ts:277` → batched upsert into `site_health`
- `src/cli/commands/report.ts:167-176` → `site_schedule`, with the diff-guard
- `src/cli/commands/github-signals.ts:68-80` → batched

Also scope `writeNextDueDates` to sites that are actually maintained — it writes
all 44 rows nightly today, and only 13 are on maintenance.

## Phase 4 — console

Fleet table (sortable/filterable); site create + archive (no create or delete
path exists in code today); report review with commentary editing and
rendered-HTML preview; full field coverage in the editor, including the eight
that nothing renders today.

Fold in the **site-status vocabulary** from the design's own section — new
values that name the behaviour they select, a mapping from the old ones, and a
one-time data migration. Do it here, while every reader is already being
touched.

## Phase 5 — freeze

Airtable goes read-only. Parity runs for one week. Nothing writes to Airtable.

## Phase 6 — retire

Delete `src/reports/airtable/**` and its callers. Keep the frozen base as an
archive; there is no reason to delete it.

## Free-tier guard-rails (land with the phase that needs them)

- Build fails on an unindexed query (`EXPLAIN QUERY PLAN`, fail on `SCAN`) —
  phase 1, before any real query volume.
- No `COUNT(*)` / aggregates on request paths; convert the live `markedSpam`
  count in `src/db/screenouts.ts:57-63` — phase 2.
- Index `submissions.resend_message_id` before the webhook path moves — phase 3.
- Nightly Turso usage check, alarming at 50% of any metric — phase 1.

## Open threads carried in

- `fix/form-e2e-budget-attribution` is **uncommitted and untested**. It splits
  the form-e2e probe's timing so `BUDGET_THIN` compares the POST span against
  `INGEST_TIMEOUT_MS` instead of click→banner. Unrelated to the migration;
  finish or discard it independently.
- `fix/skip-spam-for-in-development` is committed and green but unpushed.
- The `message` field in `beachfront-dentistry`'s `AppointmentModal.svelte`
  renders as a single-line input — it is missing `type="textarea"`. Different
  repo, one-line fix.
- `data-dynamiq` and `la-homelessness-initiative` have never recorded a
  submission and are not covered by the form-e2e probe. Unverified, not known
  broken.
