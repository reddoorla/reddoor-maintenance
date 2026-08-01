---
"@reddoorla/maintenance": minor
---

fix(fleet): disable platform auto-merge fleet-wide, let Renovate own the merge

**Behaviour change for consumers of the `self-updating` and `launch` recipes.**

GitHub's platform auto-merge is a per-PR flag that anyone with write access can
arm; the PR then merges itself later, unattended, once checks pass. On
2026-07-26 a bulk `gh pr merge --auto` sweep armed it across 8 fleet repos, and
two `actions/checkout` **major** PRs merged with zero reviews the next morning
(`reddoor-starter#77`, `reddoor-website#111`) once Renovate's own rebase cleared
their conflicts. The org Renovate preset forbids auto-merging majors and was
working correctly — Renovate never armed them — but the preset has no authority
over a flag someone else set.

- `self-updating` now **disables** GitHub platform auto-merge instead of
  enabling it. The self-heal still runs on every `self-updating` / `launch` run,
  so a repo where someone re-enables the flag gets it turned back off and the
  correction is reported as an action — a drift alarm rather than a drift
  source.
- New `disableRepoAutoMerge(repo)` on the `GitHub` wrapper. `enableRepoAutoMerge`
  is retained and exported as the documented rollback path.
- The `renovate-action` config template now runs **twice daily**
  (`0 */12 * * *`, was weekly `0 7 * * 1`). Renovate can only merge while it is
  running, so with platform auto-merge off the cron is the merge cadence, not
  just the PR-creation cadence. Sites will pick this up via `sync-configs`.
- The same template's actions are now **digest-pinned**
  (`actions/checkout@3d3c42e…` # v7, `renovatebot/github-action@1a96852b…` #
  v46.1.21). That workflow holds `RENOVATE_TOKEN`, a fleet-write PAT, so a
  mutable tag ref there was a supply-chain regression.
