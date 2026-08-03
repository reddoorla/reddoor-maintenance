---
"@reddoorla/maintenance": minor
---

protection-audit now checks that Renovate is allowed to act, not just that it ran. A fourth posture surface reads each repo's Dependency Dashboard and reports any branch Renovate has filed under "PR Edited (Blocked)" — the state that froze dependency updates on nine fleet repos for a week in August 2026 while every workflow run stayed green. Adds `GitHub.dependencyDashboard` and the pure `parseBlockedBranches` parser.
