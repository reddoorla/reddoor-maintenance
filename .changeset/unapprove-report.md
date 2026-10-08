---
"@reddoorla/maintenance": minor
---

An approved, unsent report on `/s/<slug>` now carries an "Unapprove" button (`POST /api/reports/:id/unapprove`). It clears the approval and the send-anyway flag, stamps `reports.unapproved_at` / `unapproved_by` (migrations 0041–0042), and puts the report back in the pending list, where "refresh preview" re-reads its scores. A sent, withdrawn or mid-send report is a 409 no-op.

`report --send-ready` now claims each report (`reports.send_started_at`, migration 0043) right before calling Resend, conditioned on the row still being approved, unsent and unwithdrawn, and skips a report it cannot claim. An unapprove refuses a claimed row, so from that moment the send wins; before it, the unapprove wins and nothing is sent. `OrchestrateOptions` gains a required `claimForSend`.
