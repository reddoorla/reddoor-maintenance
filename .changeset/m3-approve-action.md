---
"@reddoorla/maintenance": minor
---

feat(dashboard): one-click approve — the M3 loop closes. Each pending report on `/s/<slug>` (and a "Pending your yes" list at the top, plus a fleet-wide count banner on `/`) gets an Approve button that POSTs to the new basic-auth-gated `/api/reports/:id/approve` Netlify function. The click is a decoupled, audited flag-flip — `Approved to send = TRUE` + `Approved At`/`Approved By` stamped, never a send — and is idempotent (already-approved and already-sent rows are safe no-ops; nothing can un-approve). The next daily run's `--send-ready` step does the actual sending.
