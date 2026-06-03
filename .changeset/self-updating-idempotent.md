---
"@reddoorla/maintenance": minor
---

`self-updating` is now idempotent: it drives a repo to a known end-state (CI files on the default branch + auto-merge + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret), checking remote state and acting only on what's missing. This fixes two gaps: `init`→`self-updating` no longer skips the GitHub wiring just because `sync-configs` already wrote the CI files, and a partial-failure run now self-heals on re-run instead of leaving a repo half-configured. New remote-read methods on the `GitHub` wrapper (`filesOnBranch`, `branchProtectionContexts`, `secretExists`, `autoMergeEnabled`, `findOpenSelfUpdatingPR`).
