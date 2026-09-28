---
"@reddoorla/maintenance": minor
---

The Airtable layer is deleted (#646 steps 6–8)

Turso has been the only authoritative store since 2026-08-31. This removes the
code that still talked to Airtable, and the `airtable` devDependency. Every
write that used to go to Airtable, or to Airtable and then Turso, now goes to
Turso only.

Breaking for library consumers:

- `fromAirtableBase` and `AirtableInventoryOptions` are no longer exported.
- `draftReportForSite(siteRow, reportType, options)` no longer takes a leading
  `base`. Enrichment defaults to on unless `previewOnly`, and the header refresh
  runs unless `previewOnly` or `refreshHeader: false`.

Breaking for the CLI:

- `db import-airtable`, `db parity`, `db sync`, `db backfill-header-images` and
  `db backfill-digest-state` are removed, and so is `db --force`.
- `header-image --write-back` stores the plate in Turso only, and refuses to
  run when no Turso store is configured.
- `AIRTABLE_PAT` and `AIRTABLE_BASE_ID` are no longer read by any command,
  workflow or Netlify function. The Netlify GET health checks report
  `TURSO_DATABASE_URL` in their place.
- The fleet audit write-back files a site under `failed` when its Turso write
  throws, matches no row, or has no store, so the nightly gates red on a total
  store outage (`wrote=0`) and warn on a single failure.
- `sendApprovedReports` requires `reportSentMirror` and `siteMirror`: they are
  the only sent stamp and the only Launch flip.

Behaviour:

- The send has no Airtable header fallback. A site with no Turso plate fails its
  report by name, with the `header-image --write-back` command that fixes it.
- The report re-render has no Airtable header fallback either, and reports
  `no-header` instead.
- `selftest email` reads the Turso roster and header plate.
- `github-signals --fleet --write-back` exits 1 when any Turso write fails,
  misses or has no store configured, the same strict rule as the audit
  write-back. Turso is now the only place a signal lands.
- Messages that told the operator to fix a value in Airtable now point at the
  site's details in the console.
- `DIGEST_STATE_WRITE` no longer carries an `airtable=` counter.
- When Lighthouse returns no scores, the site's other audit values still reach
  Turso, and the site is still reported as failed.
- The audit and GitHub-signals write-back summaries read
  `→ wrote N site(s)`.
