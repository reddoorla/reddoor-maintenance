---
"@reddoorla/maintenance": patch
---

`forms-notify-target` reads the fleet — and confirms its flip — from Turso (#539 Phase 6 step 4, #646). The command answers "who would a form submission on this site email?", and the cell that decides that answer is the one `/api/forms/:slug` reads, which has been Turso's since the freeze. It listed sites from Airtable and read the Status cell back from Airtable, so it could not see a `site_<ULID>` site at all, and on a site it could see it confirmed the wrong store. The roster and the read-back now come from `readFleetRoster`, the Turso Status write is the one the read-back confirms, and the Airtable `updateSiteField` beside it stays as the shadow (skipping a site id Airtable cannot hold). The read-back guard itself is unchanged: raw cell compared against the exact string written, and an unconfirmed flip still exits non-zero.
