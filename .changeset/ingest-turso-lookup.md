---
"@reddoorla/maintenance": minor
---

feat(forms): form ingest's site lookup is now Turso-primary (#539 Phase 2)

The lead hot path no longer touches Airtable: `makeSiteLookup` reads the site
row from Turso's `sites` (kept fresh by the hourly sync), consulting Airtable
only for a slug Turso doesn't know — the new-site window between a launch and
the next sync. This retires the 2026-08-17 outage class where an Airtable
quota outage broke the site lookup while the lead store itself was healthy. An
Airtable failure during the rare fallback still lands the lead in the
dead-letter for replay.
