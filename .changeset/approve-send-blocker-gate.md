---
"@reddoorla/maintenance": minor
---

Approve-time send-blocker gate. `approveReport` now blocks (with reasons) any
report whose send is already known to throw — missing/malformed recipients,
missing header image, or a null report-level Lighthouse snapshot — via a new
pure `approveBlockers(site, report)` shared by three surfaces: the approve
endpoint (closes the vacuous gate on Launch/Announcement, which have no
checklist), the per-site dashboard's pending rows (a preflight chip: red =
blocked + button disabled, amber = To resolves to operator addresses only,
green = clear, reasons in the tooltip; the history-table approve action is
gated identically), and a new daily-digest collector that surfaces
approved-but-doomed reports as critical "will fail at send" attention items
the evening before the 09:23 UTC run would go red.
