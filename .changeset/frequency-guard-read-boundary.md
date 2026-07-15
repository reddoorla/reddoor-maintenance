---
"@reddoorla/maintenance": patch
---

Move the unrecognized-frequency guard to the read boundary. `toFrequency` (mapRow) used to silently coerce any non-exact Airtable frequency value to "None", which made due.ts's `⚠ unrecognized frequency` warning dead code and its trailing-space tolerance moot — a renamed or trailing-space select option silently dropped a site from report scheduling with zero signal. Now `toFrequency` trims first (so "Quarterly " schedules as Quarterly, preserving #197's intent), warns LOUDLY on any still-unrecognized non-empty value before coercing it to "None", and stays silent for blank cells. The unreachable warn/trim branches in due.ts are deleted, and the two due.test.ts cases that asserted the old behavior through a factory bypass now feed raw Airtable-shaped records through mapRow.
