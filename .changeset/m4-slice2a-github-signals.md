---
"@reddoorla/maintenance": minor
---

feat(github-signals): nightly fleet sweep persists three GitHub-sourced signals per site to Airtable (M4 slice 2a) — count of Renovate update PRs failing CI, default-branch CI state, and last-commit-to-default-branch timestamp. New `github-signals --fleet --write-airtable` command (runs in the nightly cron with the fleet-read token), a `defaultBranchStatus` GitHub query, and `updateGitHubSignals` Airtable writer. The cockpit reads these (slice 2b) with no request-path GitHub calls.
