# Airtable → Turso migration: design

Date: 2026-08-17
Status: approved for planning

## Why

On 2026-08-17 the Airtable Public API monthly call quota was exhausted mid-month
and returned a hard `429 PUBLIC_API_BILLING_LIMIT_EXCEEDED` on every data-API
request. Metadata endpoints (`/v0/meta/*`) kept returning 200 — the PAT was fine;
the workspace call quota was not.

The immediate cause is a call-efficiency defect, not a storage-architecture
limit. Three loops issue one HTTP request per site where Airtable accepts ten
records per request:

| Burner                    | Calls/month | Source                                       |
| ------------------------- | ----------- | -------------------------------------------- |
| Per-site audit write-back | ~1,625      | `src/audits/write-audits-to-airtable.ts:277` |
| `writeNextDueDates`       | 1,364       | `src/cli/commands/report.ts:167-176`         |
| `github-signals`          | ~544        | `src/cli/commands/github-signals.ts:68-80`   |

`writeNextDueDates` is exactly 44 rows × 31 nights = 1,364, confirmed against the
live table. Reading the _entire_ Websites table costs **one** API call (44 rows
fits a single 100-row page). Every unit of the burn is write fan-out.

The decision to migrate is therefore **not** forced by the quota — batching would
clear it. It is a deliberate choice: the operator does not consistently use the
Airtable UI, and a purpose-built console over a store we control is a better fit
for a fleet heading toward ~200 sites.

## Verified baseline

All figures read from the live base on 2026-08-17, not estimated.

- **Websites**: 44 rows, 113 columns (103 populated via API; CSV export reveals
  10 more that are blank in every row and therefore invisible to the API).
- **Reports**: 12 rows, 46 columns (32 populated).
- **Site status distribution**: maintenance 13, probably-not-our-problem 9,
  legacy 7, in-development 6, deprecated 5, hosting 2, launch-period 2.
  Only the 13 maintenance sites are actively swept.
- **Submissions (already in Turso)**: 278 rows, latest `2026-08-16T18:03:20Z`.
- Outage window: the block began between 2026-08-16 18:03 UTC (last successful
  submission write) and 2026-08-17 06:35 UTC (first failed workflow run). It was
  cleared by a plan upgrade at 2026-08-17 16:09:32 UTC. No lead loss was observed.

### CSV export is the migration instrument, and it is lossless

Proven on 2026-08-17: for both tables the CSV row count matches the API exactly
(44/44, 12/12) and every API-populated field appears as a CSV column. The CSV is
a strict superset — it also carries columns that are empty in every row, which
the API cannot return.

This resolves a real ambiguity: `mapRow` in `src/reports/airtable/websites.ts`
cannot distinguish "column renamed" from "column blank". The CSV can.

Caveat: CSV export renders attachment fields as **signed URLs that expire**. See
"Attachments" below.

## Decisions

### D1 — Keep Airtable record ids as primary keys

`submissions.site_id` already stores the Airtable `rec…` id for all 278 existing
rows. Retaining those ids as the `sites` primary key means:

- zero rewrite of existing Turso data, and no broken cross-store join;
- the parity harness can diff Airtable and Turso row-for-row during cutover;
- rollback stays cheap through the whole transition.

Rejected: clean UUID keys. Prettier, but they buy nothing here and cost a data
migration plus a class of subtle join bugs during the one window where we most
need to compare the two stores.

### D2 — Split the 113-column table by _writer_, not by topic

| Table           | Owner                | Cadence            |
| --------------- | -------------------- | ------------------ |
| `sites`         | operator             | manual, rare       |
| `site_health`   | nightly crons        | 4×/night, 13 sites |
| `site_schedule` | code (`nextDueDate`) | nightly, derived   |
| `reports`       | code + operator      | per report period  |

The large majority of health/telemetry columns have exactly one writer and it is
a nightly cron. Splitting on that line is what makes the health write a single
batched upsert instead of a per-site PATCH, and it removes the wide-table
contention where a cron and a human both write the same row.

Provenance note: the "48 of 75 columns have a single cron writer" figure comes
from the code survey, which enumerated columns by their _code references_. The
live table has 113 columns. The two counts are not contradictory — code cannot
reference a column nobody reads — but the exact writer-per-column mapping has
**not** been independently re-derived against the full 113. Phase 1 must produce
that mapping from the CSV header as its first deliverable, and the table split
above is provisional until it does.

`submissions`, `spam_screenouts`, `fleet_events`, `_migrations` are unchanged.

### D3 — Stay on Turso's free tier, and engineer against its cliff

Turso Free **hard-blocks the entire database for the remainder of the calendar
month** when any single metric (rows read, rows written, storage, syncs) is
exceeded. There is no degrade path. "Rows read" counts rows _scanned_, not
returned, so an unindexed query on a growing table is the realistic failure mode.

Free quota is 500M rows read / 10M written / 5GB per month. For 44 sites, 12
reports and 278 submissions this is enormous headroom — the cliff is reachable
only via a coding mistake. Guard-rails in "Free-tier safety" below exist
specifically to catch that class of mistake.

Escape hatch: Turso Developer at $4.99/mo converts the block into billed
overages and raises PITR from 1 to 10 days. Not taken now; the usage monitor is
the trigger to reconsider.

### D4 — Column disposition

Only **six** columns are dropped. A column is dropped only when it is empty in
every row **and** has no reader anywhere in `src/` or `netlify/`:

- `site host username`, `site host password` (never-used credential columns —
  removing them is a small security improvement)
- `launch day`, `contract link`
- `Maint: Reviewed Certificate (RETIRED — delete)`
- `Test: Bottlenecks (RETIRED — delete)`

Eighteen other columns are empty in every row but **are** read by code —
`Commentary`, the eight `Test: *` checklist columns, the `Send override` /
`Override reason` / `Override by` / `Override at` group, the three `Copy — *`
fields, `Report recipients (CC)`, `Newsletter Webhook`, `Spam Screenouts`. These
are live features that have not yet been exercised. They migrate as nullable
columns. Sparse data is not a dead feature.

### D5 — Attachments move into Turso

- **`Header image`** is regenerated from the live homepage by
  `src/cli/commands/header-image.ts` and embedded as an inline CID at send time.
  It is never publicly linked. It is therefore **not migrated at all** — it is
  regenerated into a `sites.header_image` BLOB. This sidesteps the expiring
  signed-URL problem for the field with the most bytes. At ~300KB × 44 sites
  that is ~13MB against a 5GB quota.
- **`Rendered HTML`** becomes a TEXT column on `reports`. Existing rows must be
  downloaded during the export window while their signed URLs are valid.

## Architecture

### Schema

`sites` — operator-owned config, PK = Airtable `rec…` id. Columns normalized to
snake_case: `slug`, `name`, `status`, `git_repo`, `netlify_id`,
`point_of_contact`, `report_recipients_to`, `report_recipients_cc`,
`copy_intro`, `copy_contact`, `copy_footer`, `search_query`, `ga4_property_id`,
`search_console_property`, `mailchimp_api_key`, `mailchimp_audience_id`,
`newsletter_webhook`, `notify_routing` (JSON), `maintenance_freq`,
`testing_freq`, `maintenance_day`, `testing_day`, Prismic config, Turnstile
flags, `launched_at`, `header_image` (BLOB) + filename/content-type/generated-at.

`site_health` — one row per site: Lighthouse scores, a11y/deps/security counts,
smoke and form-e2e status, domain/cert, Netlify deploy, function health, GitHub
signals, and a `last_swept_at` per check family.

`site_schedule` — `site_id`, `next_maintenance_at`, `next_testing_at`,
`computed_at`.

`reports` — `id` (Airtable rec id), `site_id`, `period`, `type`, `status`,
`draft_ready`, `approved_to_send`, `send_override`, `override_reason`,
`override_by`, `override_at`, `commentary`, `rendered_html` (TEXT), `sent_at`,
`resend_message_id`, checklist state (JSON), analytics snapshot (JSON).

List-shaped values (recipients, notify routing, checklist) use JSON columns
rather than child tables; they are never queried across sites.

Note: `Type` is blank on all 12 Reports rows. The field name expected by code
must be reconciled against the CSV header during schema mapping rather than
assumed.

### Console

Extends the existing Netlify dashboard; no new app. The
`EDITABLE_SITE_FIELDS` descriptor pattern in `src/dashboard/site-details.ts`
already provides validated editing for 12 fields and grows to full coverage, with
new field kinds (`json`, `date`, `bool`, `url`).

- Cockpit — repointed to `site_health`.
- Fleet table (new) — sortable/filterable, server-rendered.
- Site detail — all config fields editable, including the eight nothing renders
  today (`Notify Routing`, `Netlify ID`, maintenance/testing day, Search Console
  property, the Mailchimp pair, `Newsletter Webhook`).
- Site create / archive (new) — no create or delete path exists in code today;
  `grep "\.destroy(\|\.delete("` over `src/reports/airtable/` returns nothing.
- Report review — extends the existing approve flow with commentary editing and
  rendered-HTML preview.
- Submissions — unchanged.

Auth stays basic-auth + CSRF as today.

### Error handling

- **Form ingest persists before it enriches.** Today
  `src/forms/ingest.ts:149` awaits `getWebsiteBySlug` _before_ `createSubmission`,
  so a datastore failure returns 502 via `src/dashboard/handler-helpers.ts:41-43`
  and the lead is lost. The row must be written first and site resolution treated
  as enrichment. This is correct regardless of which store is behind it.
- **Turso `BLOCKED` gets its own alarm**, distinct from a generic query failure —
  it means the free-tier cliff was hit and the whole database is offline.
- `noRetryIfRateLimited: true` on the Airtable client for the remaining
  transition period: the SDK today recurses on 429 with no attempt cap
  (`lib/run_action.js:49-53`) and bypasses this repo's own throttle, hanging jobs
  to their step timeout instead of failing readably.

## Free-tier safety

1. **Build fails on an unindexed query.** `EXPLAIN QUERY PLAN` over every query
   in the repo; any `SCAN` without index support fails CI. This is the mechanism
   that turns D3's cliff from a live risk into a caught mistake.
2. **No `COUNT(*)` or aggregates on request paths.** Turso meters row scans, so
   an aggregate costs one read per row considered. The existing `markedSpam`
   live `COUNT(*)` over submissions (`src/db/screenouts.ts:57-63`) is converted
   to a precomputed counter.
3. **Nightly `turso db dump`** to an encrypted GitHub Actions artifact, with a
   _rehearsed_ restore into a scratch database. This closes the backup gap open
   since the 2026-08-02 architecture review and is a hard precondition for
   holding client leads and report history in Turso.
4. **Nightly usage check** against Turso's API, alarming at 50% of any metric, so
   the first signal is a warning rather than an outage.
5. **Index required on `submissions.resend_message_id`** before the webhook path
   moves onto Turso — it is currently unindexed and that lookup runs per delivery
   event.

## Verification

The **parity harness** is the instrument the cutover depends on: it reads both
stores and diffs field-by-field.

Per this repo's standing rule, it must be shown to pass green on the pre-cutover
state — where both stores genuinely agree — before any mismatch it reports is
treated as a finding. A harness that has only ever failed is not evidence.

Also required before it is trusted:

- The batched-write chunk fallback must be **proven** to isolate a known-bad
  record id against the real base. Airtable's batch PATCH is all-or-nothing per
  request, and four workflows gate on a `FLEET_WRITE_SUMMARY` line naming the
  exact failing slug. Until proven, a 10-slug failure line is worse diagnostics
  than today's 1-slug line.
- Existing `:memory:` db test patterns carry over unchanged.

## Sequence

- **Phase 0 — stopgap.** Persist-before-enrich in form ingest. Removes the
  single-point-of-failure that can drop a lead. Independent of the migration.
- **Phase 1 — foundation.** Schema + migrations, CSV importer, parity harness,
  nightly backup with rehearsed restore.
- **Phase 2 — readers.** Repoint cockpit, site detail, form ingest at Turso.
- **Phase 3 — writers.** Repoint the audit write-back, `writeNextDueDates` and
  `github-signals`, deleting the per-site loops.
- **Phase 4 — console.** Fleet table, full-coverage editor, create/archive,
  report review.
- **Phase 5 — freeze.** Airtable read-only; parity runs for one week.
- **Phase 6 — retire.** Delete the Airtable client layer.

## Open questions

- Dashboard page-view volume is unmeasured; it is the widest input into any
  remaining request-path load estimate.
- Airtable's per-base row ceiling is undocumented in any primary source found.
  Irrelevant after migration, but it was the credible hard stop on staying.
- Whether `Rendered HTML` history is worth preserving, or whether old drafts can
  stay in the frozen base as archive.
