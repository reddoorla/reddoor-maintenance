---
"@reddoorla/maintenance": minor
---

feat(alerts): the digest's "Needs attention" now also flags Renovate dependency-update PRs that are failing CI across the fleet (M5 slice 2). The daily run sweeps each repo's open PRs (via the shipped `collectRenovateFailures` detector behind a fleet-read `RENOVATE_TOKEN`), surfacing each red Renovate PR as a NEW/WORSE-badged item linking the PR, plus a single roll-up note for any repos that couldn't be checked (gaps are never hidden). The sweep is isolated — a GitHub hiccup yields nothing for this signal and never blanks the vuln/delivery signals — and is skipped entirely when no token is present (local runs are unaffected).
