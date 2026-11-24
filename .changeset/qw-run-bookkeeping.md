---
"@reddoorla/maintenance": patch
---

prospect audit: run bookkeeping and a pinned Lighthouse. Each probe now keeps its whole answer as `fullAnswer`. The result carries `run: { stages: { <stage>: { ms, costUsd?, calls? } }, totalCostUsd }`, built from each model call's reported `total_cost_usd`, failed calls included; it lives inside `result_json`, so no migration. Analyze is retried once, and when it still fails, the probes and accuracy stages are skipped with `ANALYZE_FAILED_SKIP` instead of being run on nothing; the report names the skip. Lighthouse runs the `@lhci/cli` this package resolves when its version is inside the pin (else `npx @lhci/cli@^0.16.0`, which a fleet site with its own older copy now gets), not whatever the npx cache holds, and `REDDOOR_LHCI_BIN` overrides it for tests. A run that lost only Lighthouse is no longer `partial`, because nothing Lighthouse measures reaches the prospect's page.
