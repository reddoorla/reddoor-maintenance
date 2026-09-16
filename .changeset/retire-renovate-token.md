---
"@reddoorla/maintenance": patch
---

Retire the `RENOVATE_TOKEN` name. `github-signals`, `protection-audit` and `renovate-dispatch` now read their fleet token from `GH_TOKEN` only (a lone `RENOVATE_TOKEN` is the no-token skip), and `readGitHubConfig` no longer returns the unused `renovateToken` field.
