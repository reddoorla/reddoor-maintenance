---
"@reddoorla/maintenance": minor
---

Fleet homepage now shows per-site cards with a11y violations, deps drift (count + major-behind), security vulnerability counts by severity, last-audited relative time, and a 4-point onboarding status. `audit --write-airtable` extended to persist the new counts to seven new `Websites` columns (`A11y Violations`, `Deps Drifted`, `Deps Major Behind`, `Security Vulns Critical/High/Moderate/Low`) alongside the existing Lighthouse fields.

**Operator action required:** add the seven new number columns to the Airtable Websites table before running `audit --write-airtable` on the new version. Missing columns won't crash — they'll just stay `null` on the dashboard until populated.
