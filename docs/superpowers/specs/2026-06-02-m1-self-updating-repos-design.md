# M1 (a+b) — Repo identity + self-updating repos

**Date:** 2026-06-02
**Status:** Approved design (brainstormed with Tucker 2026-06-02). Ready for an implementation plan.
**Part of:** [the fleet-scale roadmap](./2026-06-02-fleet-scale-roadmap.md) — Milestone 1, the keystone.
**Scope:** This spec covers **M1a (repo identity + GitHub auth)** and **M1b (the "make this repo
self-updating" recipe)** as one shippable slice. **M1c** (retrofit push+PR into the other recipes)
and **M1d** (poll GitHub status → Airtable → dashboard) are explicitly out of scope — each gets its
own spec later.

## Problem

The fleet can't keep itself current. The update recipes commit to a local `maint/*` branch and
stop — no push, no PR, no merge — and the tool has zero GitHub/CI awareness. To reach "sites update
on their own and don't get behind" at ~200 sites, each repo must update itself: routine dependency
PRs that test themselves and auto-merge when safe, with majors held for review. The tool's job is to
**bootstrap** that capability into a repo, once.

## Goals

- Store a real per-site git identity (`owner/repo`) in Airtable, and authenticate to GitHub.
- A single recipe that turns a fleet repo into a self-updating repo: it adds CI, Renovate, and the
  repo settings that make **patch/minor auto-merge on green** and **majors open a PR for review**.
- Soft and idempotent: a site without a repo identity is skipped; re-running the recipe is a noop
  when everything is already in place.

## Non-goals (this slice)

- Teaching the recipes to **push + open PRs** themselves (`sync-configs` / `svelte-4-to-5` /
  `bump-deps`) — that's M1c. _(Note: M1b does add the three CI/Renovate files to `sync-configs`'
  canonical template **set** so the standard stays unified — that's content sync, not the push+PR
  behavior, which stays deferred.)_
- Aggregating CI/PR/update status back into Airtable or the dashboard (that's M1d).
- Multi-owner token handling (see "single token for now" below).
- Lighthouse in PR CI — by decision, lighthouse stays only in the client-facing audits/reports
  (M2's scheduled audits), never in the auto-merge gate.

## Decisions locked (brainstorm 2026-06-02)

1. **Self-update = per-repo Renovate as a self-hosted GitHub Action** (not the Mend hosted app) —
   the recipe drops the workflow + config + token secret into each repo, fully self-contained, which
   suits scattered repos.
2. **Auto-merge policy: patch + minor auto-merge on green CI; majors open a PR, no auto-merge.**
3. **CI gate = `pnpm install` → format-check + lint → typecheck → build → a11y (axe) (+ `pnpm test`
   if the repo has a test script). No lighthouse.** All four layers are the Reddoor-standard bar a
   patch/minor PR must clear to auto-merge. Lighthouse stays out — it's only for the client-facing
   audits/reports (M2's scheduled audits); perf regressions are caught post-merge → M5 alert →
   revert. (Scope add 2026-06-02: a11y was added to make the gate a real quality bar, not just
   "does it compile.")
   - **a11y gate is zero-tolerance: CI fails on _any_ a11y violation** (decided 2026-06-02 — Tucker
     takes back the earlier ratchet idea). No baseline file, no regression comparison. Rationale:
     clearing each site's a11y violations is part of **bringing it into the fleet** (the
     onboarding/launch workflow), so a clean-a11y bar _is_ the onboarding checklist, and a site
     isn't "self-updating-enabled" until its a11y is clean. The CI a11y step runs
     `reddoor-maint audit --only a11y --fail-on-violations` (a new flag that exits non-zero when
     violations > 0). At ~12 real sites today this is tractable; 200 is the aspirational ceiling,
     not a current target, so the strict bar won't strand a large existing fleet.
4. **The CI is unified and fleet-synced, not a one-time drop.** The three bootstrapped files
   (`ci.yml`, `renovate.yml`, `renovate.json`) are **canonical templates joined to the
   [`sync-configs`](../../../src/recipes/sync-configs.ts) synced set** — so every site runs the
   _same_ CI, and when the standard changes, `sync-configs` propagates it across the fleet.
   `self-updating` (M1b) does the one-time bootstrap (write + GitHub settings + PR); `sync-configs`
   keeps the files current thereafter. This closes a real gap: sync-configs already unifies
   eslint/prettier/lighthouse/playwright/svelte configs, but CI was conspicuously absent.
5. **GitHub API via the `gh` CLI** (already installed + authed on the box; recipes already shell to
   `git`; `gh secret set` handles secret encryption for free) — no Octokit/sodium dependency.
6. **Two tokens.** A broad `GITHUB_TOKEN` stays on Tucker's machine (in `credentials.env`); a
   narrower `RENOVATE_TOKEN` (Contents + Pull requests + Workflows only) is what gets stored as a
   per-repo secret, minimizing the blast radius of the one that's exposed.
7. **Single token for now.** `GITHUB_TOKEN` is one token. Fine-grained PATs are per-owner; if the
   fleet spans multiple owners, that's a later refinement (a token map) — not built until the real
   repo layout is known.

## Design

### M1a — Repo identity + auth

**Airtable Websites: new field `Git repo`** (single-line text), operator-set, holding `owner/repo`
(e.g. `tucksravin/erpfunds`). Null ⇒ the site has no git wiring ⇒ all git/GitHub ops skip (soft,
mirrors how `searchQuery` gates the search check).

- `WebsiteRow.gitRepo: string | null`, mapped from `f["Git repo"]` in
  [websites.ts](../../../src/reports/airtable/websites.ts).
- The existing mis-populated `Site.repoUrl` (set to the production URL by the Airtable inventory
  provider) is a separate, pre-existing bug; note it but don't depend on it. `gitRepo` is the clean
  source of truth.

**Auth — `src/github/config.ts`:**

```text
readGitHubConfig() → { token: string, renovateToken: string } | null
```

Reads `GITHUB_TOKEN` (broad; used by the tool's `gh` calls) and `RENOVATE_TOKEN` (narrow; written
into repos as a secret) from `process.env` (loaded from `credentials.env`). Returns null when
`GITHUB_TOKEN` is unset ⇒ git/GitHub features are simply not configured ⇒ the recipe errors with a
clear "set GITHUB_TOKEN" message rather than half-running.

**GitHub access — `src/github/gh.ts`:** thin wrappers that shell out to the `gh` CLI with
`GH_TOKEN` set from config (so `gh` uses our token, not its own login). Functions, each a small
typed wrapper over one `gh` invocation:

- `openPullRequest(repo, { head, base, title, body }) → { url, number }` — `gh pr create`.
- `enableRepoAutoMerge(repo)` — `gh api -X PATCH repos/{repo} -f allow_auto_merge=true`.
- `protectBranch(repo, branch, requiredChecks: string[])` — `gh api -X PUT
repos/{repo}/branches/{branch}/protection …` requiring the named status checks (check contexts can
  be required by name before they've run).
- `setRepoSecret(repo, name, value)` — `gh secret set {name} --repo {repo}` (handles encryption).
- `repoExists(repo) / defaultBranch(repo)` — `gh api repos/{repo}` for preflight.

All shell-outs go through one `runGh(args, { token })` helper (testable: mock the exec boundary,
assert the argv — the same fake-the-SDK pattern used for Resend/GA).

### M1b — The `self-updating` recipe

A new recipe under `src/recipes/self-updating/` using the existing
[`withRecipe`](../../../src/recipes/_with-recipe.ts) framework. CLI:
`reddoor-maint self-updating [site] [--fleet <inventory>] [--dry]`.

**Plan phase** (decides noop/apply/failed): the site must have a `gitRepo`; preflight `repoExists`.
Noop when all three files already exist with current content **and** the repo settings are already
applied (auto-merge on, branch protection present, secret set). Failed (with a clear note) when
`gitRepo` is set but the repo is unreachable / token lacks scope.

**Apply phase** writes three files (templates in `src/recipes/self-updating/templates.ts`):

1. **`.github/workflows/ci.yml`** — the unified auto-merge gate. On `pull_request` + `push` to the
   default branch, a single job named **`ci`** (stable check context for branch protection):
   checkout → setup-pnpm + Node → `pnpm install --frozen-lockfile` → **format-check + lint**
   (`prettier --check` + `eslint`, via the synced canonical configs) → **typecheck**
   (`svelte-check`, or `tsc --noEmit`) → **build** (`pnpm build`) → **a11y** (run
   `pnpm exec reddoor-maint audit --only a11y --fail-on-violations` — reuses the tool's own
   axe/Playwright audit against the site's testable route, the `/dev/a11y-fixtures` page when
   present else the homepage; **fails the build on any violation**; the step installs the chromium
   browser first) → **`pnpm test`** only if a `test` script exists (guarded, many sites have none).
   Ordered cheap→expensive so it fails fast; a11y last. _No lighthouse._
2. **`.github/workflows/renovate.yml`** — self-hosted Renovate on a nightly `schedule:` (+
   `workflow_dispatch`): `renovatebot/github-action` with `token: ${{ secrets.RENOVATE_TOKEN }}`,
   configured to this repo only (no autodiscover). Renovate reads `renovate.json` from the repo.
   _(Renovate must use the `RENOVATE_TOKEN` PAT, not the default `GITHUB_TOKEN` — PRs opened by a PAT
   trigger `ci.yml`, whereas PRs opened by the default Actions token do not. This is the crux that
   makes auto-merge-on-green work.)_
3. **`renovate.json`** — extends a base preset; `packageRules`:
   - patch + minor → `automerge: true`, `platformAutomerge: true` (GitHub-native auto-merge);
   - major → `automerge: false` (opens a PR, waits for Tucker);
   - grouping + a `schedule` window to keep PR volume sane.

Then: commit on `maint/self-updating-<ts>` (existing pattern) → **`git push`** (new `push()` in
[git.ts](../../../src/util/git.ts)) → **`openPullRequest`** → **`enableRepoAutoMerge`** →
**`protectBranch(default, ["ci"])`** → **`setRepoSecret(repo, "RENOVATE_TOKEN", <value>)`**. The
recipe returns the PR URL in its notes.

`--dry` plans + reports without writing files, pushing, or touching GitHub.

### How "majors → PR, rest auto" actually executes

Renovate (running nightly in-repo via the Action, authed as the PAT) opens dependency PRs. For
patch/minor it sets GitHub-native auto-merge; the `ci` check runs (format+lint → typecheck → build
→ a11y → test-if-present); on green, GitHub merges automatically — no human. For majors it opens a
normal PR with no auto-merge;
it sits until Tucker reviews. Branch protection requiring `ci` + "Allow auto-merge" on the repo are
the settings (set once by the recipe) that make this safe and automatic.

## Components / files

- `src/reports/airtable/websites.ts` — `gitRepo` field + `mapRow`.
- Airtable Websites — new **"Git repo"** field (single-line text). _(Created during implementation,
  like the search fields.)_
- `src/cli/commands/audit.ts` (+ `src/cli/bin.ts`) — add a **`--fail-on-violations`** flag so
  `audit --only a11y --fail-on-violations` exits non-zero when a11y violations > 0 (the CI gate).
- `src/github/config.ts` — `readGitHubConfig()`.
- `src/github/gh.ts` — `runGh` + the typed wrappers above.
- `src/util/git.ts` — add `push(cwd, branch)`.
- `src/recipes/self-updating/index.ts` — the recipe (plan/apply via `withRecipe`).
- `src/recipes/self-updating/templates.ts` — `ci.yml`, `renovate.yml`, `renovate.json` canonical
  template strings + the idempotency comparison. **These are the single source of truth for the
  three files**, imported by both the bootstrap recipe and sync-configs (below).
- `src/recipes/sync-configs/` — **add the three CI/Renovate files to the synced canonical set** (the
  unification): `sync-configs` now also writes/updates `ci.yml`, `renovate.yml`, `renovate.json`
  from the same templates, so the standard stays consistent fleet-wide after bootstrap.
- `src/cli/bin.ts` + `src/cli/commands/self-updating.ts` — command wiring (`--fleet`, `--dry`).

## Testing

- **`gh.ts`**: mock the exec boundary; assert each wrapper builds the correct `gh` argv and passes
  `GH_TOKEN`. No real network.
- **recipe**: typed fakes for git + the `gh` wrappers (the established `Pick<>`-fake pattern); test
  plan(noop when present / failed when unreachable) and apply (writes the three files, commits,
  pushes, opens PR, applies the three settings, sets the secret) — assert calls + file contents.
- **`websites.ts`**: `gitRepo` round-trips through `mapRow`; fixtures updated.
- **config**: null when `GITHUB_TOKEN` unset; both tokens returned when present.
- **templates**: the rendered `ci.yml` contains all four gate steps (format+lint, typecheck, build,
  a11y) and guards `pnpm test` behind a test-script check; `renovate.json` encodes patch/minor
  automerge + major-no-automerge.
- **sync-configs**: the three CI/Renovate files are in the synced set (written when absent, updated
  when drifted, noop when current) — same as the existing config templates.
- **CLI**: `self-updating` routes single-site + `--fleet` + `--dry`.

## Operator setup (one-time)

- Two fine-grained PATs in `~/.config/reddoor-maint/credentials.env` (see
  [[credentials-go-in-config-not-repo-env]] — they go in `~/.config`, **not** the repo `.env`):
  - `GITHUB_TOKEN` — Contents + Pull requests + Workflows + Administration + Secrets (broad; stays
    on the machine).
  - `RENOVATE_TOKEN` — Contents + Pull requests + Workflows only (narrow; gets stored per-repo).
- The `gh` CLI present on the machine (it is).
- Per site: set the **"Git repo"** field (`owner/repo`) in Airtable.

## Risks / notes

- **Single token / multi-owner.** Fine-grained PATs are per-owner; if the fleet spans owners, one
  `GITHUB_TOKEN` won't reach all repos. Deferred (a token map) until the real layout is known; a
  classic PAT is the interim escape hatch.
- **Branch-protection chicken-and-egg.** Requiring the `ci` check before it has ever run is allowed
  (GitHub accepts required check contexts by name), so order doesn't matter — but verify on the
  first real repo.
- **`RENOVATE_TOKEN` is exposed in repo secrets** — hence the narrow scope. A leak can open PRs and
  push branches on that repo, not change settings or read other repos.
- **`gh` binary dependency.** Acceptable now (present locally + in Actions runners); revisit if the
  orchestration ever runs somewhere without `gh`.
- **Renovate PR volume.** Grouping + a schedule window + aggressive auto-merge on safe ranges keep
  the list from becoming its own backlog.
- **a11y in CI cost + dependency.** The a11y step boots a dev server + chromium (~1–2 min/run) and
  needs a testable route + the synced `playwright-a11y` config. It's the slowest gate step. Because
  the gate is **zero-tolerance**, `self-updating` should be enabled only **after** a site's a11y is
  clean — which is the intended sequence: a11y-cleanup is part of onboarding, and turning on
  self-update is the last onboarding step. A site with unresolved violations will (correctly) have a
  red CI until cleaned; that's the forcing function, not a bug.
