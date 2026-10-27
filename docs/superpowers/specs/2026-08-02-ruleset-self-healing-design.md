# Ruleset self-healing — design

**Problem.** Branch protection across the fleet exists only because an operator
(or agent) once ran a command. Nothing in the codebase creates or repairs GitHub
rulesets: `src/github/gh.ts` speaks only the classic
`branches/{branch}/protection` API, whose `enforce_admins: false` is exactly the
hole that let the 2026-07-26 bulk `gh pr merge --auto` sweep land two unreviewed
majors. The 2026-08-01 audit found the six NEWEST repos with no ruleset at all
(one with no protection of any kind) — the gap regrows with every onboard, and
nothing alarms when it does.

**Fix, two layers:**

1. **Heal** — the `self-updating` recipe (already `launch`'s bootstrap step 1 and
   the home of the auto-merge-off drift alarm) ensures every fleet repo carries
   the canonical ruleset, creating or repairing it idempotently.
2. **Alarm** — a nightly `protection-audit` CLI sweep enumerates the org **via
   the GitHub API, never a hand-typed or Airtable-scoped list** (an Airtable
   scope is how `.github` stayed invisible), and files the standard deduped
   tracking issue when any public repo lacks coverage.

## The canonical ruleset

Name `main: reviewed changes only`, target branch, conditions
`~DEFAULT_BRANCH`, enforcement `active`, **`bypass_actors: []`** (an empty
bypass list is the entire point — it binds admins, which classic protection
never did). Rules: `deletion`, `non_fast_forward`, `pull_request`
(0 approvals — one-member org, GitHub forbids self-approval), and — stage 2
only — `required_status_checks` on `ci / ci` with
`strict_required_status_checks_policy: true`.

## Invariants the implementation must hold

- **Two-stage, evidence-gated.** Requiring a status-check context that never
  fires makes a repo with an empty bypass list **permanently unmergeable by
  everyone, including admins**. So `required_status_checks` is only added when
  the `ci / ci` check-run has actually been OBSERVED on the default branch's
  HEAD commit. Not-yet-observed (brand-new repo before its first CI run, or a
  repo like `.github` whose ci.yml is `workflow_call`-only and emits no runs)
  ⇒ create with the refs rules only; the check upgrades on a later pass once
  evidence exists. False-negative (missed check) degrades to stage 1 — safe;
  false-positive is impossible since we name-match real check-runs. This also
  derives the `.github` exception instead of hand-listing it.
- **Never weaken.** Healing merges TOWARD the floor; it never strips. Existing
  extra rules (e.g. a hand-added `required_linear_history`), stronger
  `pull_request` parameters (e.g. `required_review_thread_resolution: true`),
  and other repos' required status-check contexts are all preserved. Two
  deliberate exceptions, both pure weakenings: a non-empty `bypass_actors` is
  drift and heals to empty, and so are **ref exclude patterns** — GitHub
  applies exclude over include, so `exclude: ["refs/heads/main"]` neutralizes
  the whole ruleset while every other floor check still passes (the
  least-destructive-looking admin edit, functionally equivalent to disabling
  it). The pure logic cannot resolve which patterns match the default branch,
  so the floor is NO excludes; extra _includes_ are preserved (they only
  strengthen). Both were review findings, not first-draft design.
- **Union contexts, never replace** — same lesson as the classic
  `protectBranch` PUT (see the "MERGING it with the branch's existing required
  contexts" test): when adding `ci / ci` to an existing
  `required_status_checks` rule, other required contexts survive.
- **Update is `PUT`, not `PATCH`.** `PATCH repos/{repo}/rulesets/{id}` returns
  404; a PATCH-based implementation would silently no-op on every drifted repo
  while reporting success. (Verified live 2026-08-01.)
- **Repo-sourced rulesets only** (`includes_parents=false`): org-level rulesets
  aren't ours to manage (and don't exist on the Free plan).
- **Private repos are skipped by a visibility gate**, silently: rulesets on
  private repos require a paid plan, so attempting would either fail every run
  or spam a phantom "action" that flips the recipe to `applied` forever.
  Classic protection remains their floor. Revisit if the org upgrades.
- **Match by exact name.** A repo with a differently-named PR-enforcing ruleset
  (today only `reddoor-maintenance`, which is not a fleet site) would get a
  second, union-enforced ruleset — harmless, and the audit judges coverage by
  shape, not name.

## Pure core, thin shell

The invariant logic lives in `src/github/rulesets.ts` as pure functions —
`desiredRuleset(check)`, `rulesetGaps(existing, check)`,
`healRuleset(existing, check)` — unit-tested directly, with `gh.ts` supplying
only thin API wrappers (`listRepoRulesets`, `getRuleset`, `createRuleset`,
`updateRuleset`, `checkContextObserved`, `repoVisibility`, `listOrgRepos`).
The recipe wires them: no ruleset ⇒ create; gaps ⇒ PUT the healed payload and
record the gaps in `actions` (visible drift alarm); no gaps ⇒ no call, `noop`
preserved.

`protection-audit` reuses `rulesetGaps` for its coverage verdict: a repo is
covered iff some repo-sourced ruleset has zero gaps at stage 1; the stage-2
check is reported per-repo as information. Exit 1 on any gap; the
`fleet-security.yml` nightly runs it and files/auto-closes the
"Fleet protection coverage gap" tracking issue via the existing
fleet-lighthouse pattern.

Three alarm-honesty rules in that wiring, all adversarial-review findings
(the first would have shipped the whole alarm DEAD): the step must
`set -o pipefail` (Actions' default `bash -e {0}` has no pipefail, so `| tee`
otherwise swallows the exit 1 forever); an empty `RENOVATE_TOKEN` in CI is a
step FAILURE, not the CLI's local-dev clean-skip (a skip verifies nothing);
and the issue auto-CLOSE requires positive evidence — the
`PROTECTION_AUDIT gaps=0` machine line — never step outcome alone, so no
zero-exit path can convert into a false "Recovered".

Accepted residual: the evidence gate observes the check on default-branch
pushes, not pull_request events. A hand-edited push-only ci.yml would pass the
gate and then block PRs. (2026-08-02 addendum: ci.yml was REMOVED from
SELF_UPDATING_CONFIGS — it is per-site parameterized (netlify-site,
node-version, permissions), so the exact-match heal was an armed fleet-wide
clobber; the starter owns its shape and Renovate bumps its reusable-workflow
pin. The recipe therefore no longer corrects this drift — the exposure is one
bricked-PR repo, visible on its next PR.) Un-brick path: ruleset ADMIN
operations are not ref-gated (verified live — an idempotent PUT succeeds under
`current_user_can_bypass: never`), then fix the ci.yml triggers by push.

## Explicitly out of scope

Retiring the hand-rolled `gh api PUT .../protection` in the `new-site` skill
(follows once this lands — the skill should invoke the recipe), the Renovate
GitHub App identity (separate PR; when a bypass actor for the App is ever
wanted, `desiredRuleset` is the single place to add it), and
`reddoor-maintenance`'s own missing CI gate (release-path review first).
