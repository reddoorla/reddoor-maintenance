---
"@reddoorla/maintenance": patch
---

`renovate-dispatch --fleet` retries each target once, after a 5 s wait, before counting it failed (#1660). Since #1612 the fleet-security nightly reds on `failed>0`, so one transient 5xx on the PR probe, the default-branch lookup or the dispatch no longer reds the whole run. A target that fails both attempts is still `failed`, with the second error, and still reds the step. A GitHub secondary rate limit wants a minute or more, so it is not covered.
