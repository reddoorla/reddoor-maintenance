# 2026-10-29 — Quarterly is the default maintenance frequency (P1-91, site-launch.md step 13)

Landed in this PR, docs only.

At Roalson's launch the operator answered the schedule question with "quarterly maintenance, record that as the default" (10-28, 6:30pm PT). Step 13 of `docs/runbooks/site-launch.md` now says so: a worker records `maintenance_freq` as Quarterly unless the operator names another, and the operator decides the day, Testing, and any exception to Quarterly. The row reformat is prettier re-widening the table for the longer cell; no other step changed.

No code default came with it. The brief allowed one only if a single obvious path seeds `maintenance_freq` on a new row, and none does: `ensure-site` (`src/fleet/ensure-site.ts`) creates a row with name, url, `building`, git repo and contact, and leaves `maintenance_freq` and `maintenance_day` blank (its `site_schedule` row starts with null due dates), so `launch-check`'s `schedule` step reads `missing` until someone sets both the frequency and the day. Seeding Quarterly there would still leave `maintenance_day` blank, which the same check refuses, so the default would buy nothing but a half-filled schedule. The same rule is in `reddoorla/reddoor-workspace` `CLAUDE.md`. Review round 1 found the step's Who cell no longer said who picks `maintenance_day`; it now says the operator does, with Testing.

Usage: $8.09, 292/52638 tokens, 23026533/364634 cache, rate limit allowed_warning (session so far, 6:47pm PT).
