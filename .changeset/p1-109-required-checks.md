---
"@reddoorla/maintenance": patch
---

land-prs: the checks wait now also waits for every check the base branch requires, from its rulesets' `required_status_checks` rule and its classic branch protection, until each has a passing, neutral or skipped run or status on the head. A required check with no run yet (an Actions run still queued) is no longer read as "checks passed": it is waited for under the checks timeout, and a timeout names it ("required check `ci / ci` has no run on 9329069 after 20 min"). A required check that never fires therefore costs the full timeout before that stop. A cancelled required check stops at once. A base whose rules or branch protection read 403 or 404 requires nothing from that source, as before (#2035).
