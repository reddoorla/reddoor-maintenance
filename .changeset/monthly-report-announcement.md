---
"@reddoorla/maintenance": minor
---

Add a one-time **site-care announcement** email, as a new `Announcement`
report type riding the existing draft → approve → send pipeline. A new `announce`
recipe + CLI (`reddoor announce` for all `maintenance` sites, or
`reddoor announce <site>` for one) drafts a personalized email per client that
tells them what to expect going forward: the site's **testing and maintenance
cadence** read from the Websites row (`testing freq` / `maintenence freq`,
rendered as e.g. "Full site testing — every quarter"; a `None` pace is omitted),
a live preview of the site's latest Lighthouse scores framed as the latest full
site test (same client-facing labels as the real report), recent-improvement
callouts (forms now delivered via Resend; the Svelte 4 → 5 modernization —
default-on fleet-wide, with the per-client approve review as the relevance
backstop), and a soft open door to expand scope. Pure-value framing, no pricing.
`createDraft` gains an optional `subjectOverride`. The send path is reused
unchanged — an Announcement renders by type and does not flip Status.

Operational prereq: add an `Announcement` option to the Airtable `Report type`
single-select before running (the API can't add select options).
