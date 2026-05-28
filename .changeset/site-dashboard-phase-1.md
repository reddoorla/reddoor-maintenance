---
"@reddoorla/maintenance": minor
---

Add per-site dashboard at `/s/<slug>?t=<token>`, deployed by the existing Netlify site. Pulls site metadata + lighthouse scores + recent reports from Airtable; gated by a new `Dashboard Token` field on the Websites row (operator generates one per site, rotated by replacing the value). Pure render module (`renderSiteDashboardHtml`) + constant-time token compare (`verifyDashboardToken`) are exported from the package entry for library consumers and CLI preview use.

Operator setup: add a single-line-text field named `Dashboard Token` to the Websites table, generate a token with `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`, paste into the row. The dashboard URL becomes shareable immediately.

Phase 1 surfaces what's already in Airtable today — lighthouse 4-tile + recent reports list. Phase 2 (extending `audit --write-airtable` to persist lint/deps/security/a11y findings + adding those tiles) lands in a follow-up. Custom domain (e.g. `status.reddoor.la`) is operator DNS work; the function is domain-agnostic.
