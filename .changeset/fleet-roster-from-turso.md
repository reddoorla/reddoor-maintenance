---
"@reddoorla/maintenance": minor
---

`--fleet turso` reads the fleet roster from the database (#539 Phase 6 step 4, #646). It selects exactly what `--fleet airtable` selected — live `maintained` sites with a `url` — and it also sees sites that `ensure-site` created with a `site_<ULID>` id, which have no Airtable record. `--fleet airtable` is now a deprecated alias: it reads the same Turso roster and prints a warning to stderr naming the store it read. It does not read Airtable any more. The five nightly sweeps (`fleet-lighthouse`, `fleet-smoke`, `fleet-security`, `fleet-form-e2e`, `fleet-prismic-drift`) now pass `--fleet turso`. The selection rule moved into `selectFleetSites` (`src/inventory/select.ts`), which both inventory providers use. `fromAirtableBase` keeps `meta.airtableRowId` and adds `meta.siteId`. A new test feeds the same rows to both stores and requires the same site set. Write-back and the other batch readers are separate changes.
