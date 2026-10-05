---
"@reddoorla/maintenance": minor
---

The cockpit and the daily digest no longer raise a vuln that Renovate is still fixing on schedule. `markWaiting` (new, `src/alerts/waiting.ts`) marks a non-exhausted vuln as waiting, from the digest snapshot's `firstFlaggedAt`: a transitive-only one until `LOCKFILE_SETTLE_DAYS` (2) after the first Monday 18:00 UTC lock-file window that opens after it was first flagged, a direct one for `DIRECT_VULN_WAIT_DAYS` (7) or until its auto-fix is exhausted. A waiting item stays on the site's `/s/<slug>` page as a `waiting:` chip and leaves the cockpit's tiers, the Needs-you feed and the digest's asks. Past its threshold it returns with a title naming the window it outlived or the day it was first flagged, and it now reaches the digest too. `buildSiteAlarmContext` takes the digest snapshot as an optional last argument; `AttentionItem` gains `transitiveOnly` and `waiting`.
