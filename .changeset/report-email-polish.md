---
"@reddoorla/maintenance": minor
---

Report email polish — three client-facing improvements to the maintenance report:

- **Analytics trend.** The ANALYTICS section now shows direction, rate, and raw change vs the previous period — `▲ 24% vs last period (549 → 679)` — instead of two bare numbers. Growth is green; a dip or flat is muted grey (a traffic dip isn't a failure). "New this period" when the prior period was a real 0. Pure presentation of data already fetched.
- **GA "unavailable" vs "zero" are now distinct.** `ReportData.gaUsersCurrent/Previous` are optional; when GA is unconfigured / has no property ID / the fetch failed, the email renders "— Users" and "Last Period: —" rather than a misleading "0".
- **Subject line carries the period.** `"{Site} — May 2026 Maintenance Report"` (UTC month/year from the report's completed-on date) for inbox scannability and archival. `Subject override` still wins.

Also a correctness fix (was flagged in the 2026-05-29 review, never fixed, and widened by the recent header `alt`/`href` work): **site name, URL, and commentary are now XML-escaped before the strict MJML render.** Previously a client named with an `&` ("Brown & Co"), or a `<`/`"` in a URL or commentary, threw at render time and blocked the send. Added a regression test covering `&`, `<`, and `"`.
