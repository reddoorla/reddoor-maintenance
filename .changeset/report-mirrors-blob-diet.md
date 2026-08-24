---
"@reddoorla/maintenance": minor
---

feat(db): report-write mirrors + BLOB-free site reads (#539 Phase 2)

Approve/override and the resend-webhook's delivery status now mirror their
Airtable writes into Turso `reports` (same pattern as the editor's
write-through), so the page re-render after an action shows the new state
immediately instead of after the next hourly sync — the prerequisite for the
site-dashboard/cockpit repoints. And the fleet-state read layer now selects
explicit sites columns instead of selectAll: since the header-image backfill,
the BLOB column holds multi-MB JPEGs that would otherwise ride along on every
ingest lookup and 44× per fleet list. A schema-lockstep test keeps the column
list complete as migrations add columns.
