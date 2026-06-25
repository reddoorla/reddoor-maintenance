---
"@reddoorla/maintenance": minor
---

Dashboard: reorganize the fleet cockpit around "check nothing's on fire". A glance
verdict (✓ All clear / ⚠ N sites need you) leads the page, followed by a single
per-site, navigation-only "Needs you" feed (Broken → Waiting on your yes → Slipping;
every row opens the site page). The fleet card browser and the submissions/spam inbox
move into collapsed lanes, and the card filters now work (one flat grid, no nested
collapsed tiers). Vulns only enter the feed once Renovate's auto-fix is exhausted, so
the verdict can read All clear while the fleet patches in the background. The fleet
sweep button is relabeled Refresh → Audit.
