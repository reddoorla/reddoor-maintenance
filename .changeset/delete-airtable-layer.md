---
"@reddoorla/maintenance": minor
---

The Airtable layer is deleted (#646 steps 6–8)

Turso has been the only authoritative store since 2026-08-31, and since #933
Airtable received no writes at all. This removes the code that still talked to
it, and the `airtable` devDependency.

Breaking for library consumers:

- `fromAirtableBase` and `AirtableInventoryOptions` are no longer exported.
- `draftReportForSite(siteRow, reportType, options)` no longer takes a leading
  `base`. Enrichment defaults to on unless `previewOnly`, and the header refresh
  runs unless `previewOnly` or `refreshHeader: false`.

Breaking for the CLI:

- `db import-airtable`, `db parity`, `db sync`, `db backfill-header-images` and
  `db backfill-digest-state` are removed, and so is `db --force`.
- `header-image --write-back` stores the plate in Turso only, and refuses a
  site when no Turso store is configured.
- `AIRTABLE_PAT` and `AIRTABLE_BASE_ID` are no longer read by any command,
  workflow or Netlify function.

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
- The audit and GitHub-signals write-back summaries read
  `→ wrote N site(s)`.
