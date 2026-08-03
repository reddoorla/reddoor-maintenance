---
"@reddoorla/maintenance": minor
---

Take the best-effort tail off the visitor's critical path.

`ingestSubmission` awaited notify → stamp → newsletter fan-out before
returning, so the submitting site — which waits on that response under an abort
budget (`INGEST_TIMEOUT_MS`) — was made to wait on Resend, Mailchimp and site
webhooks. None of that work can cost the lead: the row is already durable and
every step is swallowed+logged. It was pure latency in front of the visitor's
only signal, which is how a captured 1836dig lead was reported as a failed
submission on 2026-08-03 while the operator email was already delivered.

`IngestDeps` gains an optional `defer`, and the `form-ingest` handler passes
Netlify's `context.waitUntil` — the tail now runs after the response. On the
measured path that removes ~1.1s (Resend ~0.8s + stamp ~0.3s) from what the
visitor waits for, and permanently decouples the visitor-facing outcome from
email/webhook provider latency.

Absent `defer` the tail runs inline exactly as before, so this is a latency
change and never a behavioural one — every existing caller and test is
unaffected. The handler is capability-guarded: a runtime without `waitUntil`
falls back to the inline tail rather than silently dropping the notification,
because a slow notification is recoverable and a lost one is not.

An accepted result now reports `notifyStatus: "deferred"` when the tail was
handed off — the in-request outcome does not exist in that case, and the real
one still lands on the row via `stampNotified`.

`TESTMODE_SKIPPED_WORK_MS` drops from 2s to 1s to match: the sink work the
`form-e2e` probe skips is now just the scans and the insert.
