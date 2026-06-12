---
"@reddoorla/maintenance": minor
---

feat(cockpit): the cockpit now surfaces the GitHub-sourced signals (M4 slice 2b). Sites with Renovate update PRs failing CI or a red default-branch build join the 🔴 attention tier (chips + NEW/WORSE badges + new `prs`/`ci` filters), and the 🟡 Watch tier's staleness now uses the real last-commit-to-`main` timestamp (slice 2a) instead of the audit-age proxy. Pure collectors read the persisted Websites fields — still zero request-path GitHub calls. The summary bar gains "N PRs failing" / "N CI red" counts.
