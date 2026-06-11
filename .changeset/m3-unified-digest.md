---
"@reddoorla/maintenance": minor
---

feat(reports): `report --digest` — one daily "your fleet today" operator email. A "Ready for your yes" section lists every draft-ready, unapproved, unsent report with a link to its dashboard page; a typed "Needs attention" section ships as the M5 alerting seam (empty for now, renders "all clear"). Skips the send entirely when there is nothing to report (no-noise default), dedupes same-day re-fires via a `digest-<date>` Resend idempotency key, and sends to `OPERATOR_EMAIL` (fallback `info@reddoorla.com`). Dashboard origin from `DASHBOARD_BASE_URL` (fallback the live Netlify origin). Email-client-safe HTML (charset, table layout, https-only links).
