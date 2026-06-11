---
"@reddoorla/maintenance": minor
---

feat(reports): `report --due` is now idempotent — a re-run never double-drafts. Each due (site, type) is keyed by the UTC `YYYY-MM` of its due date (`reportPeriodKey`), stamped onto the new Reports `Period` field at draft time, and skipped when a row for that key already exists. Skips surface in the output and never trip a non-zero exit, so a cron re-fire is a safe no-op. The manual single-site `report <slug>` path intentionally still always drafts.
