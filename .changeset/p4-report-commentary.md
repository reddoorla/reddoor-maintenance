---
"@reddoorla/maintenance": patch
---

Report review: edit commentary from the console (#539 Phase 4).

Commentary is the one part of a client report an operator writes by hand, and it
was editable only in Airtable. The dashboard now offers it inline on any report
that has not been sent.

The lock is `sentAt`, not approval: approving schedules the send for the next
09:23 UTC run, so a typo spotted in that window is still fixable, but once the
email is out the stored row must keep matching what the client actually read.
The editor renders for the whole unsent window — in the pending list, and as a
sub-row in the history table for approved-awaiting-send.

Writes go to Airtable and mirror into Turso (`ReportMirrorPatch` gains
`commentary`), so the page re-render right after a save shows the new text rather
than the old one until the next hourly sync.
