---
"@reddoorla/maintenance": minor
---

`protection-audit` now verifies the full posture floor per public repo, not just ruleset shape: secret scanning + push protection must be enabled, and the renovate workflow must exist, be active, and have actually run within 3 days (GitHub silently disables quiet schedules, and template-cloned schedule triggers may never register — the first live sweep caught two never-run and two stale repos).
