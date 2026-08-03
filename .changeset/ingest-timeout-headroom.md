---
"@reddoorla/maintenance": patch
---

Stop reporting an already-captured lead to the visitor as a failed submission.

`INGEST_TIMEOUT_MS` goes from 8s to 20s. The old budget was calibrated against a
10s Netlify synchronous-function limit; the envelope is now 30s
(`SYNCHRONOUS_FUNCTION_TIMEOUT`), so the headroom argument that produced 8s no
longer holds — and 8s did not actually clear a **cold** central call.

Central ingest persists the submission BEFORE its best-effort tail (notify →
stamp → fan-out), so once the row exists the lead is captured. A client-side
abort after that point tells the visitor their message failed while it is
already saved and emailed — the visitor's only signal says the opposite of the
truth, and a retry duplicates the lead.

Observed on 1836dig 2026-08-03: row `sub_f4f195ff` stored with
`notify_status: sent`, operator email delivered, and the browser still showed
the site's failure copy. Measured on the same day, a cold central call runs
~5-7s (cold start ~1.9s + Airtable slug lookup ~2.4s + Turso open/migrate +
insert + Resend ~0.8s), leaving the 8s budget with no real margin. 20s is ~3x
that path and still leaves 10s of the envelope for the action to render.

The fleet's `form-e2e` probe could not have caught this: its `testMode`
submissions short-circuit in `ingestSubmission` before the classifier, the
insert, and the Resend call, so the probe never exercises the slow path that
real submissions pay.
