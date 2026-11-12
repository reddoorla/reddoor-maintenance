---
"@reddoorla/maintenance": patch
---

land-prs: the checks wait now also waits for every context the base branch's `required_status_checks` rule names, until each has a passing, neutral or skipped run or status on the head. A required check with no run yet (an Actions run still queued) is no longer read as "checks passed"; a timeout names it ("required check `ci / ci` has no run on 9329069 after 20 min"), and a cancelled required check stops at once. A base whose rules read 403 or 404 behaves as before (#2035).
