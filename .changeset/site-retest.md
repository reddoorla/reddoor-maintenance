---
"@reddoorla/maintenance": minor
---

`reddoor-maint site-retest <slug>` re-tests one site during the day (P1-88). It reads the site's current reasons from Turso, the same list its `/s/<slug>` page shows, runs only the audits behind them, writes that site's row alone, and prints which reasons cleared (`RETEST_RESULT site=… cleared=N still=M write=ok`). The audits it may run are browser (uptime, render, links, titles), domain (domain, certificate), function-health (function, CMS), netlify-deploy and lighthouse. `--only` takes a subset of those and refuses anything else, so security, deps and a11y are never re-tested. `--dry-run` prints the plan. `audit --fleet turso` gains `--site <slug>` to audit one roster site.
