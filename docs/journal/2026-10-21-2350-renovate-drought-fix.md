# 2026-10-21 — The Renovate drought fix is proven on two repos and stored as a `.github` patch; the drought alarm stops counting base-prefixed security merges (#1673)

The worker for the operator's answer to reddoor-workspace `decisions/2026-10-21-2218-renovate-feature-drought.md` (option 1), brief `briefs/2026-10-21-renovate-drought-fix.md`. This PR carries the #1673 fix and `docs/patches/2026-10-21-github-renovate-grouped-immediate-held-group.patch`. The proof's full record is reddoor-workspace `audits/2026-10-21-renovate-feature-drought/addendum-2026-10-21-proof.md`.

**#1673.** `isFeatureUpdateBranch` excluded `renovate/lock-file-maintenance` and `renovate/npm-…-vulnerability` only. On a staging-flow repo Renovate prefixes every branch with its base, so `renovate/main-npm-vite-vulnerability` counted as a feature update, and fleet-security run 39655255844 printed six drought repos as DELIVER. Both tests now take an optional `<base>-` segment. The new test rebuilds that run's eight DELIVER repos from the issue's table. It asserts states, not day counts, because the times of day are in neither source. The two real deliverers (alamo-anatomy's `renovate/main-all-minor-patch`, reddoor-website) still read delivering. The six read drought ×5 and unmeasured ×1, with summary `drought=5 delivering=2 unmeasured=1`. Mutations, each red: the old vulnerability regex (2 tests), excluding every `renovate/main-` branch (3), and the old lock-file test (1). The second gap on the issue (`renovateMergeWindow` ignores `base.ref`) is left as the issue left it. It is moot while every staging merge is a security PR.

**The proof.** The probe used two repos, reddoor-starter#197 and canvas-starter#36. Each ran four arms of the fleet's action with debug logs: the preset with and without the two rules, as a dry run and as a real run. All four runs on each repo agree:

- The real control logged `Branch created …/all-minor-patch`, then `Branch status pending, current sha`, and opened no PR. That is hedloc's 10-19 run.
- The real test created the branch and its PR in the same run, for both the grouped branch and the new `held-minor-patch`.
- The dry test logs `PR is configured for automerge` for `all-minor-patch`, where the control logs "not configured".

Real runs were needed because a dry run commits nothing, and so never reaches the early return that (a) removes.

**Beliefs corrected on contact.**

- (a) was not new. The 09-29 worker wrote the same rule for #898 (`docs/patches/2026-09-29-github-renovate-grouped-pr-immediate.patch`, Operator decisions 15), and nobody opened it from the laptop. The drought ran four more Mondays on a fix that was already written. The new patch supersedes it.
- A global config's own keys do not override the preset it `extends`. The preset resolves at repository level and wins. The first probe run lost its schedule override that way, then opened six draft vulnerability PRs and four dashboard issues under `probe/`. The second run, with the scalars in `force` and the rules as presets listed after the fleet preset, autoclosed all ten. `force` cannot carry rules: it replaces `packageRules` outright.
- `branchPrefixOld` defaults to `renovate/`, and Renovate falls back to it when a branch is missing. A probe under its own prefix without pinning `branchPrefixOld` would have pushed the real `renovate/all-minor-patch`. This was read in the source before the real runs, not discovered by them.

**erp-industrial#60.** A debug dry run of the unchanged preset (erp-industrial#81) logs `Would merge PR #60` on a run that pushes nothing, so no config holds it. The likely reason it has sat 30 days is that nearly every run pushed (49 force-pushes), and a pushing run skips automerge. Filed as #1684.

**Not delivered: the `.github` PR.** The cloud cannot attach `reddoorla/.github` (`add_repo` refuses names starting with "."), and the GitHub connector refuses it too. The patch applies cleanly on `.github` `2de84b3`. It adds the two rules and a `validate.yml` check, which was red on today's preset and on four mutations and green on the patch. Opening the PR from the laptop is the operator's step, before Monday 10-26.
