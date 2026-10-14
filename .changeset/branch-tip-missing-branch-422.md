---
"@reddoorla/maintenance": patch
---

`protection-audit` no longer reports a Renovate branch that the Dependency Dashboard names but Renovate has not yet created as a failed probe. GitHub answers that branch's commit lookup with HTTP 422 "No commit found for SHA", not 404, and `branchTip` now reads that answer as "no branch". Every other 422 is still a failed probe.
