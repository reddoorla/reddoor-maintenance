---
"@reddoorla/maintenance": minor
---

New `preflight [site] | --all` command: read-only pre-send checks over the live
Airtable rows. Fails on anything that would make `report --send-ready` throw
(missing/malformed recipients, missing header image, unrecognized frequency) and
warns on what send-time validation can't see: operator addresses left in a client
site's resolved To, a To-override shadowing the point of contact, unsent queued
drafts that would race the new report, stale (>13-month) schedule anchors, and
all-rows-empty load-bearing columns (the Airtable column-rename failure mode).
Exit 0 = safe (warnings printed), 1 = hard failure, 2 = bad args. Never writes,
never sends.
