---
"@reddoorla/maintenance": patch
---

The Resend webhook looks reports up in Turso instead of Airtable (#539 Phase 6 step 2, #646). A new `findReportByMessageId(db, messageId)` in `src/db/fleet-state.ts` serves it, backed by migration `0027_reports_resend_message_index` (an index on `reports.resend_message_id`, applied on the next connection). The Turso write now runs first; the Airtable `Delivery status` write stays as a shadow while `AIRTABLE_PAT` and `AIRTABLE_BASE_ID` are set, and can still fail the request during the rollback window. The webhook no longer returns 500 when the Airtable env is absent: it skips the shadow and logs `AIRTABLE_SHADOW skipped=env-absent` (or `env-partial`).
