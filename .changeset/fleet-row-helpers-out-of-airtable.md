---
"@reddoorla/maintenance": patch
---

Internal: the site/report row models and their pure coercers (`WebsiteRow`, `ReportRow`, the site-status vocabulary, `canonicalizeStatus`, `parseNotifyRouting`, `toVerdict`, `toFrequency`, `parseSecurityAdvisories`, `siteSlug`, …) moved out of `src/reports/airtable/` into `src/fleet/site-status.ts`, `src/fleet/site-row.ts` and `src/reports/report-row.ts`, so the Turso read path (`src/db/fleet-state.ts`) no longer loads the Airtable layer at runtime (#539 Phase 6 step 1, #646). The Airtable modules re-export every moved name, so no import changes and no behavior changes; a new test fails if any surviving `src/db` module value-imports from `src/reports/airtable/` again.
