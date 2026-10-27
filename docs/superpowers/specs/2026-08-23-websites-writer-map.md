# Websites writer map (Phase 1.1 of the Airtable → Turso migration)

Date: 2026-08-23
Status: derived from the LIVE schema + code scan, not the 08-17 CSV
Design: [`2026-08-17-airtable-to-turso-migration-design.md`](2026-08-17-airtable-to-turso-migration-design.md)

The design marked its four-table split **provisional until this map exists**.
This is that map. Every claim below is derived from two instruments run on
2026-08-23, both cheap and both repeatable:

- **Schema + population**: the Airtable metadata API (all 113 live columns —
  the API that stayed 200 through the 08-17 outage) plus ONE data-API call
  (44 rows) counting populated cells per column. Not the Desktop CSVs, which
  no longer exist and were six days stale.
- **Code references**: an exact-quoted-string scan of `src/` + `netlify/` for
  each column name, hand-classified read vs write by the owning function
  (`mapRow` at websites.ts:429–534 is the read side; the `*Fields` builders +
  `update*` writers at 650–1120 are the write side), plus a second pass for
  variable-name writes (`updateSiteField` callers: the dashboard editor and the
  launch recipe's `STATUS_COLUMN`).

Live-schema drift since the design's 08-17 snapshot, found by re-deriving:
the two `RETIRED — delete` columns are **already deleted** by the operator, and
`Prismic Ack Until` was **added** (#532). Net 113 columns either way — the
matching total is a coincidence of +1/−2 against the design's 113 having
counted one differently; the point of this file is that the LIVE list is now
the authority.

## Verdict on the split: it holds

75 columns are code-referenced; 38 are not. Every code-written column has
**exactly one writer**, and the writers partition cleanly along the design's
table lines. No column has two code writers pulling in different directions —
the one shared-write column (`Status`) is operator-owned with a single
scripted transition (launch flow), noted below.

## `site_health` — writer: the nightly audit write-back (one batched upsert)

All written via `updateAuditFields` / the `update*Counts` family, all read by
the cockpit/digest. One writer, one cadence. 4×/night today; becomes a single
batched upsert per sweep.

| columns                                                                                                                 | family              |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `pScore` `rScore` `bpScore` `seoScore` `Last lighthouse audit at`                                                       | lighthouse          |
| `A11y Violations`                                                                                                       | a11y                |
| `Deps Drifted` `Deps Major Behind` `Deps Outdated` `Deps Major Outdated`                                                | deps                |
| `Security Vulns Critical/High/Moderate/Low` `Last security audit at` `Security advisories` `Security Auto-Fix Attempts` | security            |
| `Domain checked at` `Cert days remaining`                                                                               | domain              |
| `Crossbrowser OK` `Mobile OK` `Links OK` `Broken links` `Browser checked at`                                            | browser             |
| `Deploy status` `Last deploy at` `Deploy log URL` `Deploy checked at` `Netlify ID`*                                     | netlify-deploy      |
| `Function health` `CMS Reachable` `Turnstile widget` `Function health checked at`                                       | function-health     |
| `Uptime Reachable` `Titles & Meta OK`                                                                                   | browser/uptime      |
| `Smoke OK` `Last Smoke At`                                                                                              | smoke               |
| `Form E2E OK` `Form E2E checked at`                                                                                     | form-e2e            |
| `Renovate Failing CIs` `Default Branch CI` `Last Commit At` `GitHub Signals At`                                         | github-signals cron |
| `Prismic Models` `Prismic Models Checked At` `Prismic Models Drift`                                                     | prismic-drift cron  |

\* `Netlify ID` is read-only in code (config, operator-entered) — it belongs in
`sites`, listed here only because the deploy family reads it. Moved to `sites`
below.

## `site_schedule` — writer: `updateNextDueDates` (report cron, derived)

`Next maintenance at` · `Next testing at`. Code-owned since #347; nightly
write-back of a value derived from `maintenence freq`/`testing freq` + send
history. Also the place to apply the plan's note: scope the write to actively
maintained sites (today it writes all 44 rows nightly; only 13 are swept).

## `sites` — writer: the operator (dashboard editor, Airtable UI, launch flow)

**Dashboard-editable today** (the 12 `EDITABLE_SITE_FIELDS`):
`point of contact` · `Report recipients (To)` · `(CC)` · `Copy — Intro` ·
`— Contact` · `— Footer` · `Search query` · `GA4 property ID` · `Git repo` ·
`Status` · `maintenence freq` · `testing freq`

**Airtable-UI-only today — the console MUST absorb these before Phase 5's
freeze, or the workflow that writes them dies with the freeze:**
`Accepted Watch Conditions` · `Prismic Ack Until` (the entire ack/mute
workflow has NO code write path) · `Netlify ID` · `Search Console property` ·
`Notify Routing` · `Newsletter Webhook` · `Mailchimp Audience ID` ·
`Mailchimp API Key` · `Require Turnstile` · `maintenance day` · `testing day`

**Code-written but sites-owned:**

- `Name` `url` `point of contact` `Git repo` — also seeded by `ensure-site`
  (new-site bootstrap)
- `Status` — also flipped `in development → maintenance` by the launch recipe
  (`forms-notify-target.ts`, `STATUS_COLUMN`); the vocabulary rework lands here
  (design §"Site status values need semantic names")
- `Launched at` — written once by `updateLaunched` (launch flow)
- `Header image` — regenerated by the `header-image` CLI + refreshed
  best-effort at draft time; becomes the `sites.header_image` BLOB (design D5),
  not migrated

## Dropped — verified against live data (D4's rule: empty everywhere AND unreferenced)

| column                   | populated | referenced                            |
| ------------------------ | --------- | ------------------------------------- |
| `site host username`     | 0         | no                                    |
| `site host password`     | 0         | no                                    |
| `launch day`             | 0         | no                                    |
| `contract link`          | 0         | no                                    |
| `Spam Screenouts` (link) | 0         | no — screenouts already live in Turso |

The design's other two drops (`Maint: Reviewed Certificate` / `Test:
Bottlenecks`, both RETIRED) no longer exist in the live schema.

`Reports` and `Submissions` link columns also do not migrate **as columns** —
Turso joins by `site_id`/Airtable rec id (design D1). `Reports` is
code-referenced (reports.ts:7 creates the link) and that call site is deleted
in Phase 3 when report rows move.

## The 33 populated-but-unreferenced columns — decision needed at 1.2

Everything else unreferenced is POPULATED (1–38 rows each): the launch-era
checklist (`client approval`, `googled`, `check cms`, …), hosting/DNS/CMS
reference cells, `account owner`, `form submissions`. No code reads any of
them; the console will not render them.

**Recommendation:** migrate them into a single `sites.legacy` JSON column
keyed by original column name, rather than 33 dead columns the schema then
carries forever. The frozen base (Phase 6 keeps it as archive) remains the
canonical historical record either way.

**Flag for the operator:** `DNS password` (4 rows), `cms password` (2 rows),
`DNS username` / `cms username` are live plaintext credentials sitting in
Airtable. Recommend they do NOT migrate into Turso at all — not even into
`legacy` — and live on only in the frozen base. Nothing in code has ever read
them, and a new store should not inherit plaintext credentials on day one.

## Cross-checks

- 75 referenced + 38 unreferenced = 113 = the live schema. ✓
- The 75 matches the design's provenance note ("the code survey enumerated 75
  code-referenced columns"). ✓
- Every `site_health` column's single writer was located to a specific
  function; no health column is dashboard-editable and no `sites` column is
  cron-written (the launch-flow `Status`/`Launched at` writes are
  operator-triggered, not scheduled). ✓
