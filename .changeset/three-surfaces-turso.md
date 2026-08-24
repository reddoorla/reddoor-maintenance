---
"@reddoorla/maintenance": minor
---

feat(dashboard): submissions page, trigger-renovate, and the site-detail
editor read from Turso (#539 Phase 2)

Three more request-path surfaces repoint to the fleet-state read layer. The
submissions page and trigger-renovate no longer touch Airtable at all. The
site-detail editor reads from Turso, still writes Airtable (the Phase 2 source
of truth), and now MIRRORS each saved cell into `sites` immediately — so a
Turso-reading page shows the edit at once instead of after the next hourly
sync. The mirror reuses the importer's own column map (one truth), with a
lockstep test making an unmapped editor field a build failure.
