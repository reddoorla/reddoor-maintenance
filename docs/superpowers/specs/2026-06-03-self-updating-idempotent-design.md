# self-updating: idempotent "ensure end-state" recipe — Design

**Date:** 2026-06-03
**Status:** implemented (PR on `feat/self-updating-idempotent`)

> Implementation note: the file-presence reader shipped as `filesOnBranch(repo, branch, paths)` — taking the branch explicitly rather than the spec's original `filesOnDefaultBranch(repo, paths)`, since `base` is already resolved. Same behavior, more general signature.

## Problem

`self-updating` (M1) bootstraps a repo to keep itself current: writes `ci.yml`,
`renovate.yml`, `renovate.json`, opens a PR, and wires GitHub (auto-merge,
branch protection requiring `ci`, the `RENOVATE_TOKEN` secret). Today the whole
recipe is gated on a single **local working-tree** drift check: if the three CI
files already exist locally and match the templates, `plan()` returns `noop` and
the GitHub wiring is **never applied**.

Two failures follow from that:

1. **`init` → `self-updating` skips the wiring.** `sync-configs` (run by `init`)
   now writes the three CI files (they joined `ALL_TEMPLATES`). So by the time
   `self-updating` runs, the files are present → it noops → the repo gets the CI
   files but **no branch protection, no secret, no auto-merge**. Discovered
   onboarding `erp-industrial` (a from-scratch, un-onboarded repo).
2. **Partial-failure leaves a half-configured repo (Important #2).** If a GitHub
   call fails mid-apply (e.g. `setRepoSecret` after `protectBranch`), the files
   are written but wiring is incomplete, and a re-run noops on the local files —
   so the repo is stuck half-configured with no automatic recovery.

The root cause is that one local check conflates "files present locally" with
"repo fully wired on GitHub."

## Goal

Make `self-updating` an **idempotent operation that drives a repo toward a known
end-state**, checking _remote_ state and acting only on what's missing. Running
it any number of times converges to: the three CI files on the default branch +
auto-merge on + branch protection requiring `ci` + the `RENOVATE_TOKEN` secret.

## Design

Two independent concerns, each checked against remote state and acted on only if
missing:

- **A. CI files on the default branch** (`ci.yml`, `renovate.yml`, `renovate.json`)
- **B. Repo settings** (auto-merge, branch protection requiring `ci`, the secret)

### New read methods on the `GitHub` interface

All are thin `gh api` wrappers (private `gh()` helper already throws on non-zero;
the existence checks tolerate 404 the way `repoExists` does).

| Method                                   | Returns                                | Implementation                                                                                               |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `filesOnDefaultBranch(repo, paths)`      | `string[]` (subset of `paths` present) | `GET repos/{repo}/contents/{path}?ref={base}` per path; 404 → absent                                         |
| `branchProtectionContexts(repo, branch)` | `string[]`                             | `GET repos/{repo}/branches/{branch}/protection`; read `.required_status_checks.contexts`; 404 → `[]`         |
| `secretExists(repo, name)`               | `boolean`                              | `GET repos/{repo}/actions/secrets`; check `.secrets[].name`                                                  |
| `autoMergeEnabled(repo)`                 | `boolean`                              | `GET repos/{repo}`; read `.allow_auto_merge`                                                                 |
| `findOpenSelfUpdatingPR(repo)`           | `string \| null`                       | `GET repos/{repo}/pulls?state=open`; first whose head ref starts with `maint/self-updating-`; return its URL |

Existing methods (`openPullRequest`, `enableRepoAutoMerge`, `protectBranch`,
`setRepoSecret`, `repoExists`, `defaultBranch`) are unchanged.

### `selfUpdating` control flow (rewritten — no longer uses `withRecipe`)

`withRecipe`'s `plan→noop/apply` shape and mandatory branch creation don't fit a
recipe that must ensure repo settings without touching the working tree. The
function builds its `RecipeResult` directly.

```
selfUpdating(site, deps = {}):
  repo = resolveRepo(site)            // site.gitRepo else origin remote
  if !repo: return failed "no Git repo (set Airtable 'Git repo' or add an origin remote)"

  cfg = readGitHubConfig()
  renovateToken = deps.renovateToken ?? cfg?.renovateToken
  if !deps.github && !cfg: return failed "GITHUB_TOKEN not set"
  if !renovateToken: return failed "no RENOVATE_TOKEN available"
  github = deps.github ?? makeGitHub({ token: cfg!.token })

  base = await github.defaultBranch(repo).catch(() => "main")
  actions = []                        // human-readable record of what changed

  // ---- A. CI files on the default branch ----
  present = await github.filesOnDefaultBranch(repo, TEMPLATE_PATHS)   // 3 paths
  if present.length < TEMPLATE_PATHS.length:
    existingPR = await github.findOpenSelfUpdatingPR(repo)
    if existingPR:
      actions.push(`bootstrap PR already open: ${existingPR}`)
    else:
      // touches the working tree → clean-tree required here only
      if !(await isWorkingTreeClean(site.path)): return failed "working tree not clean"
      branch = branchName("self-updating")
      await createBranch(site.path, branch)
      for t in templates: mkdir+writeFile(join(site.path, t.path), t.contents)
      await commit(site.path, "ci: enable self-updating (CI + Renovate auto-merge)")
      await (deps.pushBranch ?? push)(site.path, branch)
      pr = await github.openPullRequest(repo, { head: branch, base, title, body })
      actions.push(`opened PR ${pr.url}`)

  // ---- B. settings (check-then-ensure, each independent) ----
  if !(await github.autoMergeEnabled(repo)):
    await github.enableRepoAutoMerge(repo); actions.push("enabled auto-merge")
  if !(await github.branchProtectionContexts(repo, base)).includes("ci"):
    await github.protectBranch(repo, base, ["ci"]); actions.push("required ci check on " + base)
  if !(await github.secretExists(repo, "RENOVATE_TOKEN")):
    await github.setRepoSecret(repo, "RENOVATE_TOKEN", renovateToken); actions.push("set RENOVATE_TOKEN secret")

  return actions.length
    ? { status: "applied", notes: actions.join("; ") }
    : { status: "noop",    notes: "already self-updating" }
```

`TEMPLATE_PATHS` = the `.path` of the three `SELF_UPDATING_CONFIGS` templates.

### Status semantics

- **`applied`** — at least one action taken (PR opened and/or a setting changed);
  `notes` enumerates exactly what.
- **`noop`** — files already on `base` AND all three settings already correct.
- **`failed`** — missing repo/token, dirty working tree (bootstrap path only), or
  a GitHub call threw; `notes` says which step.

### Error handling & self-healing

Each ensure step is independently guarded by its own remote check, so a run that
fails partway (e.g. secret call errors after protection succeeds) is recoverable:
re-running re-checks remote state and completes only the remaining steps. This is
the Important #2 fix. No new retry machinery — idempotency _is_ the recovery.

### Testing

Unit tests with a `fakeGitHub` that records calls and stubs the new readers:

- **fresh repo** (no files on base, no settings): opens PR + enables auto-merge +
  protects + sets secret → `applied`, notes list all four.
- **fully wired** (3 files on base, auto-merge on, `ci` required, secret present):
  no mutating calls → `noop`.
- **half-configured / self-heal** (files on base, auto-merge on, `ci` required,
  secret absent): only `setRepoSecret` called → `applied`.
- **protection lacks `ci`** (other contexts present or none): `protectBranch`
  called with `["ci"]`.
- **existing open PR** (files absent but a `maint/self-updating-*` PR is open):
  no second PR opened; noted.
- Keep a local-checkout integration test (`gitInit`) covering the bootstrap path
  (branch/write/commit/push) with `pushBranch` stubbed.

## Scope / YAGNI

- **Branch protection:** when `ci` is not among the required contexts, set our
  standard protection requiring `["ci"]`. Do **not** build preservation of
  arbitrary pre-existing protection rules — fleet repos don't have them (caltex
  had none; `branchProtectionContexts` returns `[]` on 404). If a repo ever has
  custom protection, handling it is a separate, later concern.
- **Duplicate-PR guard:** `findOpenSelfUpdatingPR` prevents opening a second
  bootstrap PR on re-run before the first merges. Branch names stay timestamped.
- Out of scope: changing `sync-configs` (it legitimately ships the CI files);
  changing `init`'s step order; the jsconfig→tsconfig conversion (separate, still
  manual / future recipe).

## Files touched

- `src/github/gh.ts` — five new read methods on `makeGitHub` / the `GitHub` type.
- `src/recipes/self-updating/index.ts` — rewrite `selfUpdating` per the flow above;
  drop the `withRecipe` wrapper; import `branchName`, `createBranch`, `commit`,
  `isWorkingTreeClean`, `push` from the git util.
- `tests/github/gh.test.ts` — tests for the new readers.
- `tests/recipes/self-updating.test.ts` — the scenario matrix above.
- `.changeset/` — patch/minor note.
