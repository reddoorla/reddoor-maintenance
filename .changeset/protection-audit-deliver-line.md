---
"@reddoorla/maintenance": patch
---

`protection-audit` prints a `DELIVER <repo>` line for each repo whose last feature-update Renovate merge is inside the drought threshold, and a repo whose probe failed now prints an UNMEASURED `WARN` line and counts in `RENOVATE_OUTCOME unmeasured=` instead of dropping out of the measure. The nightly closes its Renovate drought issue only on repos it saw deliver (#1606).
