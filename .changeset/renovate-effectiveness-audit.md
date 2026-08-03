---
"@reddoorla/maintenance": minor
---

protection-audit now checks that Renovate is allowed to act, not just that it ran. A fourth posture surface reads each repo's Dependency Dashboard and reports branches Renovate has filed under "PR Edited (Blocked)" — the state that froze dependency updates on nine fleet repos for a week in August 2026 while every workflow run stayed green.

A blocked branch is reported only when nothing will clear it on its own: pushing a commit onto an open Renovate PR puts it in the same section, and that is routine practice rather than a fault, so a branch counts as a gap only when its tip was authored by a machine or it has sat untouched past `BLOCKED_STALE_DAYS`. The surface also reports dashboard sections it does not recognise, so a future heading rename cannot turn the fleet green in silence — Renovate already renamed this one once, in 43.0.0.

Adds `GitHub.dependencyDashboard`, `GitHub.branchTip`, and the pure `parseBlockedBranches` / `parseUnknownSections` / `isMachineAuthor` helpers.
