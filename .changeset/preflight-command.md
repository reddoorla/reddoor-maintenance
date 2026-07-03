---
"@reddoorla/maintenance": minor
---

New `preflight [site] | --all` command: read-only pre-send checks over the live
Airtable rows. Fails on what would make drafting or `report --send-ready` throw
(missing/malformed recipients, missing header image, missing Lighthouse scores
for Maintenance/Testing drafts) and on RAW frequency cells the mapper would
silently coerce to "None" (typos, trailing spaces — the site quietly drops off
the schedule). Warns on what send-time validation can't see: operator addresses
left in a client site's resolved To, unsent queued drafts that would race the
new report (the current cycle's own payload is informational, not a warning),
and truly stale schedule anchors (suppressed when a newer Sent-at supersedes
them). Fleet mode mirrors the real pipelines: Announcement checks announce's
maintenance-status targets; Maintenance/Testing check everything `report --due`
schedules (eligible + null-status rows). Exit 0 = safe (warnings printed),
1 = hard failure, 2 = bad args. Never writes, never sends.

Also exposes `maintenanceFreqRaw`/`testingFreqRaw` on `WebsiteRow` (the literal
Airtable cells behind the coerced frequencies) and exports `ELIGIBLE_STATUSES`
from due.ts.
