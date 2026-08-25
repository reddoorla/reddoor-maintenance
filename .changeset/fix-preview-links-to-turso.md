---
"@reddoorla/maintenance": patch
---

Fix: report preview links pointed at expiring Airtable URLs.

`/api/reports/:id/preview` was built in Phase 2 to serve a report's rendered body
from Turso, precisely because Airtable attachment URLs are signed and expire — a
dashboard tab left open 404s. Nothing ever linked to it, so the expiring URL
stayed in front of the operator.

Both the pending-approval "draft preview" link and the history table's "view"
link now point at the dashboard's own route. The attachment's presence still
gates whether a link renders at all; it just no longer supplies the destination.
