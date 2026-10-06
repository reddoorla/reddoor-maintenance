---
"@reddoorla/maintenance": minor
---

`audit` names the Lighthouse audits behind a failed category assertion. Each failing site prints one `LIGHTHOUSE_FAILURES assertions=… audits=… site=…` line, and the fleet write-back stores the list in `site_health.lighthouse_failing_audits` (migration 0040), shown on the site dashboard.
