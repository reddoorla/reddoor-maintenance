---
"@reddoorla/maintenance": patch
---

`protection-audit` prints a `DELIVER <repo>` line for each repo whose last feature-update Renovate merge is inside the drought threshold, so the nightly can close its Renovate drought issue only on repos it saw deliver (#1606).
