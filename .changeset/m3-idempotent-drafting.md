---
"@reddoorla/maintenance": minor
---

feat(reports): `report --due` is now idempotent — a re-run never double-drafts. Each due (site, type) is keyed by the UTC `YYYY-MM` of its due date (`reportPeriodKey`), stamped onto the new Reports `Period` field at draft time, and skipped when a row for that key already exists. Skips surface in the output and never trip a non-zero exit, so a cron re-fire is a safe no-op. The manual single-site `report <slug>` path intentionally still always drafts.

Also fixes a pre-existing live-Airtable break this work surfaced: report queries filtered linked-record `{Site}` fields by record id inside `filterByFormula`, which Airtable renders as primary-field _names_ — so the filter matched nothing, `lastSent` was never found, and dueness was computed from fallbacks. Reports are now fetched unfiltered (one paged query instead of N) and matched by record id client-side, so `report --due` dueness is correct against the real base for the first time.
