---
"@reddoorla/maintenance": minor
---

protection-audit: a non-default Renovate base branch's required status check counts only if no one can bypass it (#981). Each `required_status_checks` rule from `rules/branches/{b}` is joined through its `ruleset_id` to that ruleset's `bypass_actors`. The branch is a gap when every contributing ruleset has a bypass actor, of any type and mode, and no classic required context gates it. A ruleset returned without `bypass_actors`, a rule with no `ruleset_id`, or a ruleset read that fails reads `(unverified, not clean)`. A new non-gating `RULESET_BYPASS unread=N read=M` summary line counts the rulesets read without a `bypass_actors` field, which shows whether the sweep's token can see bypass lists at all. `branchRequiredChecks` now returns each rule's `ruleset_id`.
