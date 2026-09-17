---
"@reddoorla/maintenance": minor
---

The operator digest, `preflight` and the `submissions` re-score name lookup read the fleet from Turso (#539 Phase 6 step 4, #646). `report --digest` and `preflight` open one libSQL connection per run and hand `runDigest`/`preflight` their two datasets (`listSites`, `listAllReports`) as required readers; `collectAttention` takes the rows outright and opens no store of its own for them. Airtable is left holding exactly one call in the digest run — the digest-state shadow write. A site created by the Turso-native `ensure-site` (a `site_<ULID>` id with no Airtable record) now appears in the morning digest and in preflight instead of being invisible to both.
