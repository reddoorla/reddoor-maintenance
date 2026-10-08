---
"@reddoorla/maintenance": minor
---

An approved, unsent report on `/s/<slug>` now carries an "Unapprove" button (`POST /api/reports/:id/unapprove`). It clears the approval and the send-anyway flag, stamps `reports.unapproved_at` / `unapproved_by` (migrations 0041–0042), and puts the report back in the pending list, where "refresh preview" re-reads its scores. The write is conditioned on the row still being approved, unsent and unwithdrawn, so a sent or withdrawn report is a 409 no-op and a send stamped first wins the race.
