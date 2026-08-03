---
"@reddoorla/maintenance": minor
---

Make the `form-e2e` probe report budget headroom, not just pass/fail.

The probe submits with the `testMode` marker, which short-circuits in
`ingestSubmission` right after site resolution — before the spam classifier,
the repeat-sender/duplicate scans, the row insert, the Resend notify and the
stamp. Its elapsed time is therefore a LOWER BOUND on what a real submission
costs, and a green verdict said nothing about the rest of the path.

That is how 1836dig recorded `Form E2E OK: pass` at 13:24 on 2026-08-03 while
real submissions at 18:23 were being reported to visitors as failures: the
probe never paid the ~2s of sink work that pushed the real call past the
site's abort budget. The one signal watching the fleet's conversion path
structurally could not see the failure.

The probe now times the submit itself (click → success banner), projects what
a real submission would have cost (`+ TESTMODE_SKIPPED_WORK_MS`, estimated
rather than measured — making testMode do the real work would persist
bot-triggerable rows or send real email), and warns when that projection
exceeds half of `INGEST_TIMEOUT_MS`.

A thin budget warns on the RUN while the persisted verdict stays `pass` — the
form does work, and flipping the cockpit to `fail` would report a working form
as broken. The nightly `fleet-form-e2e` workflow raises the `BUDGET_THIN` line
as a GitHub warning so the signal is not buried in the log.

A runner that reports no timing (injected fakes, anything predating this)
never manufactures a warn.
