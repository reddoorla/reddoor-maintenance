# M7.1 — Reusable CI workflow + org Renovate preset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-repo copy-pasted CI job and `renovate.json` with a single reusable GitHub Actions workflow and a single Renovate preset, both hosted in a new `reddoorla/.github` repo, so "fix CI once" and "fix dependency policy once" become real across the fleet.

**Architecture:** `reddoorla/.github` hosts the canonical reusable workflow (`.github/workflows/ci.yml`, `on: workflow_call`) and the Renovate preset (`renovate-config.json`). Each fleet repo carries a ~6-line thin caller and a 3-line `renovate.json` that `extends` the preset. The caller SHA-pins the reusable workflow (`@<sha> # v1.0.0`); Renovate's `github-actions` manager keeps the SHA current. `@reddoorla/maintenance`'s `sync-configs` templates and `self-updating` recipe are updated to ship the thin shims and to require the new (nested) status-check context.

**Tech Stack:** GitHub Actions reusable workflows (`workflow_call`), Renovate config presets + `github-actions` manager, TypeScript (`@reddoorla/maintenance` CLI), Vitest, Changesets, `gh` CLI + GitHub REST API.

**Spec:** `docs/superpowers/specs/2026-06-08-m7-1-reusable-ci-and-renovate-preset-design.md`

**Per-stage research:** Every stage begins with a research step. The worker MUST complete it (WebFetch/WebSearch against the named authoritative sources, or the `deep-research` skill for anything ambiguous) and reconcile findings against this plan BEFORE editing. If a finding contradicts a plan assumption (especially the status-check context name or the reusable-workflow `uses:` syntax), STOP and surface it rather than proceeding on the plan's assumption.

---

## File Structure

**New repo `reddoorla/.github`:**

- Create: `.github/workflows/ci.yml` — reusable workflow (`on: workflow_call`), the canonical CI steps.
- Create: `renovate-config.json` — the org Renovate preset (today's per-repo `renovate.json` body + `helpers:pinGitHubActionDigests`).

**In `reddoor-maintenance`:**

- Modify: `src/recipes/sync-configs/templates.ts` — `ci` template → thin caller; `renovateConfig` template → `extends` the preset.
- Modify: `src/recipes/self-updating/index.ts:105-108` — required status-check context `ci` → the new nested context.
- Modify: `tests/recipes/ci-templates.test.ts` — replace the two now-obsolete content assertions (inline CI gate; inline renovate packageRules) with thin-shim assertions.
- Create: `.changeset/m7-1-reusable-ci.md` — release the new template shapes.

**Rollout targets (no code, ops only):** `reddoorla/reddoor-starter` (verify-first), `reddoorla/caltex-landing` (canary), then the remaining 14 fleet repos via `self-updating`.

---

## Stage 1: Create `reddoorla/.github` with the reusable workflow + Renovate preset

**Files:**

- Create (in the new repo): `.github/workflows/ci.yml`, `renovate-config.json`

- [ ] **Step 1 — Research (REQUIRED before any edit)**

Verify against authoritative sources, and reconcile with this stage's assumptions:

- GitHub reusable workflows: <https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows> — confirm (a) `on: workflow_call` is the trigger; (b) a reusable workflow file MUST live under `.github/workflows/`; (c) `permissions` can be declared in the reusable workflow; (d) the org `.github` repo is a valid host for reusable workflows callable by other repos in the same org (check private-repo sharing settings: Settings → Actions → "Access" must allow the org's repos to call workflows from `.github`).
- `actions/checkout` behavior inside a reusable workflow: confirm a no-`repository`-arg checkout checks out the **caller** repo (`github.repository` = caller). Source: GitHub Actions contexts docs.
- Latest stable release tags + commit SHAs for `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (use `gh api repos/<owner>/<repo>/tags` or the releases page). Record the exact `@<sha> # vX.Y.Z` pairs to use.
- Renovate preset file resolution: <https://docs.renovatebot.com/config-presets/> — confirm `github>reddoorla/.github:renovate-config` resolves to `renovate-config.json` at the repo root, and that `helpers:pinGitHubActionDigests` is a valid built-in preset.

Write the confirmed action SHAs into this stage's Step 3 before committing.

- [ ] **Step 2 — Create the repo and clone it locally**

```bash
gh repo create reddoorla/.github --public --description "Org-wide reusable workflows + Renovate preset (M7.1 fix-once home)"
cd /tmp && git clone https://github.com/reddoorla/.github.git reddoorla-dotgithub && cd reddoorla-dotgithub
```

Expected: empty repo cloned to `/tmp/reddoorla-dotgithub`.

- [ ] **Step 3 — Write the reusable workflow**

Create `.github/workflows/ci.yml` (substitute the real SHAs captured in Step 1 for the `<sha>` markers; keep the `# vX.Y.Z` comments so Renovate can track them):

```yaml
name: ci
on:
  workflow_call:
permissions:
  contents: read
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # v4.x.y
      - uses: pnpm/action-setup@<sha> # v4.x.y
      - uses: actions/setup-node@<sha> # v4.x.y
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prettier --check .
      - run: pnpm exec eslint .
      - run: pnpm exec svelte-kit sync && pnpm exec svelte-check --tsconfig ./tsconfig.json
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm exec reddoor-maint audit --only a11y --fail-on-violations
      - name: Test (if present)
        run: |
          if node -e "process.exit(require('./package.json').scripts?.test ? 0 : 1)"; then
            pnpm test
          else
            echo "no test script — skipping"
          fi
```

This is the canonical CI verbatim from the old inline `ci` template, with `on:` changed to `workflow_call` and third-party actions SHA-pinned.

- [ ] **Step 4 — Write the Renovate preset**

Create `renovate-config.json` (the body that was per-repo, plus digest-pinning so callers' SHA refs stay current):

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", "helpers:pinGitHubActionDigests"],
  "schedule": ["before 7am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["patch", "minor"], "automerge": true, "platformAutomerge": true },
    { "matchUpdateTypes": ["major"], "automerge": false }
  ]
}
```

- [ ] **Step 5 — Commit, push, tag `v1.0.0`, and capture the SHA**

```bash
git add .github/workflows/ci.yml renovate-config.json
git commit -m "feat: reusable ci workflow + org renovate preset (M7.1 v1.0.0)"
git push origin main
git tag v1.0.0 && git push origin v1.0.0
git rev-parse v1.0.0
```

Expected: a 40-char commit SHA printed. **Record this SHA — Stage 2 bakes it into the caller template.**

- [ ] **Step 6 — Enable org-repo access to the reusable workflow (if Step 1 found it required)**

If `.github` is public this is automatic. If private, set Settings → Actions → General → "Access" → "Accessible from repositories in the 'reddoorla' organization", or via API:

```bash
gh api -X PUT repos/reddoorla/.github/actions/permissions/access -f access_level=organization
```

Expected: `204`/no error. (Public repo: skip.)

---

## Stage 2: Thin `ci` + `renovate-config` templates in `reddoor-maintenance`

**Files:**

- Modify: `src/recipes/sync-configs/templates.ts`
- Modify: `tests/recipes/ci-templates.test.ts`

- [ ] **Step 1 — Research (REQUIRED before any edit)**

- Confirm the Renovate `github-actions` manager updates **reusable-workflow** `uses:` refs (not only marketplace actions) and recognizes the `@<sha> # vX.Y.Z` digest+comment form: <https://docs.renovatebot.com/modules/manager/github-actions/>. Confirm the comment must carry a full semver (`# v1.0.0`), not a bare major (`# v1`), for digest tracking.
- Confirm a thin caller still needs its own `on:` triggers and that the called job inherits the reusable workflow's `permissions` (vs. needing them in the caller). Source: the reuse-workflows doc from Stage 1.
- Reconcile: the caller template below uses `@<SHA from Stage 1 Step 5> # v1.0.0`. If research shows a bare-major comment is required/preferred for your Renovate setup, adjust the comment accordingly and note it.

- [ ] **Step 2 — Write the failing test (update `ci-templates.test.ts`)**

Replace the `it("ci.yml runs the four-layer gate ...")` block and the `it("renovate.json auto-merges patch/minor but not major")` block with:

```ts
it("ci.yml is a thin caller of the org reusable workflow", () => {
  const ci = templatesByName(["ci"])[0]!.contents;
  expect(ci).toMatch(/uses:\s+reddoorla\/\.github\/\.github\/workflows\/ci\.yml@[0-9a-f]{40} # v/);
  expect(ci).toContain("on:");
  expect(ci).toContain("pull_request");
  // the gate now lives in the reusable workflow, not here
  expect(ci).not.toContain("reddoor-maint audit");
  expect(ci).not.toContain("pnpm build");
});

it("renovate.json is a thin shim extending the org preset", () => {
  const cfg = JSON.parse(templatesByName(["renovate-config"])[0]!.contents);
  expect(cfg.extends).toContain("github>reddoorla/.github:renovate-config");
  expect(cfg.packageRules).toBeUndefined();
});
```

- [ ] **Step 3 — Run the test to verify it fails**

Run: `pnpm vitest run tests/recipes/ci-templates.test.ts`
Expected: FAIL — the new assertions don't match the still-inline `ci`/`renovate-config` templates.

- [ ] **Step 4 — Update the `ci` template (minimal implementation)**

In `src/recipes/sync-configs/templates.ts`, replace the entire `const ci: ConfigTemplate = {...}` block with (substitute the real 40-char SHA from Stage 1 Step 5):

```ts
const ci: ConfigTemplate = {
  config: "ci",
  path: ".github/workflows/ci.yml",
  contents: `name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ci:
    uses: reddoorla/.github/.github/workflows/ci.yml@<SHA_FROM_STAGE_1> # v1.0.0
`,
};
```

- [ ] **Step 5 — Update the `renovateConfig` template**

Replace the entire `const renovateConfig: ConfigTemplate = {...}` block with:

```ts
const renovateConfig: ConfigTemplate = {
  config: "renovate-config",
  path: "renovate.json",
  contents: `{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>reddoorla/.github:renovate-config"]
}
`,
};
```

- [ ] **Step 6 — Run the test to verify it passes**

Run: `pnpm vitest run tests/recipes/ci-templates.test.ts`
Expected: PASS (all blocks, including the unchanged `.prettierignore`/`netlify`/`renovate.yml` assertions).

- [ ] **Step 7 — Run the full check gate locally**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. (If `prettier --check` flags the edited files, run `pnpm format` and re-run.)

- [ ] **Step 8 — Commit**

```bash
git add src/recipes/sync-configs/templates.ts tests/recipes/ci-templates.test.ts
git commit -m "feat(sync-configs): ci + renovate templates -> thin shims (reusable workflow + org preset)"
```

---

## Stage 3: Update `self-updating` to require the new status-check context

**Files:**

- Modify: `src/recipes/self-updating/index.ts:105-108`

- [ ] **Step 1 — Research (REQUIRED before any edit)**

- Determine the exact status-check **context name** a reusable-workflow job produces. Authoritative behavior: when caller workflow job `ci` calls a reusable workflow whose job is `ci`, the check run is reported as `ci / ci`. Verify via GitHub docs/community: <https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows> and a confirming source (e.g. github community discussions on reusable-workflow status check names). **This is the riskiest assumption in the whole plan.** Treat the value as _provisional_ — Stage 5 reads the real value from the live checks API on the starter and this constant is corrected there if it differs.

- [ ] **Step 2 — Replace the required-check constant**

In `src/recipes/self-updating/index.ts`, change the branch-protection block (currently lines ~105-108):

```ts
if (!(await github.branchProtectionContexts(repo, base)).includes("ci")) {
  await github.protectBranch(repo, base, ["ci"]);
  actions.push(`required ci check on ${base}`);
}
```

to use a named constant defined near the top of the file (just below the existing `SELF_UPDATING_CONFIGS` constant):

```ts
// Reusable-workflow jobs report their check as "<caller-job> / <reusable-job>".
// The thin `ci` caller (job `ci`) calls reddoorla/.github's reusable workflow (job `ci`),
// so the required context is "ci / ci", NOT "ci". Verified empirically on the starter (M7.1).
const REQUIRED_CHECK = "ci / ci";
```

and the block becomes:

```ts
if (!(await github.branchProtectionContexts(repo, base)).includes(REQUIRED_CHECK)) {
  await github.protectBranch(repo, base, [REQUIRED_CHECK]);
  actions.push(`required "${REQUIRED_CHECK}" check on ${base}`);
}
```

- [ ] **Step 3 — Run the self-updating tests + full gate**

Run: `pnpm vitest run tests/recipes && pnpm typecheck && pnpm lint`
Expected: PASS. If any existing self-updating test asserts the literal `"ci"` context, update that assertion to `REQUIRED_CHECK` / `"ci / ci"`.

- [ ] **Step 4 — Commit**

```bash
git add src/recipes/self-updating/index.ts tests/
git commit -m "feat(self-updating): require nested reusable-workflow check context (ci / ci)"
```

---

## Stage 4: Release the new `@reddoorla/maintenance` version

**Files:**

- Create: `.changeset/m7-1-reusable-ci.md`

- [ ] **Step 1 — Research (REQUIRED before any edit)**

Confirm the release path is healthy now that the org Actions-create-PR toggle is on (flipped 2026-06-08): a merge to `main` with no pending changesets + a bumped version triggers `release.yml`'s OIDC publish, and the changesets-action can now open the Version Packages PR itself. Re-read `.github/workflows/release.yml` and confirm no `NPM_TOKEN` is needed (OIDC trusted publishing). Confirm `package.json` `repository.url` points at `reddoorla` (fixed in PR #117) so provenance validates.

- [ ] **Step 2 — Write the changeset**

Create `.changeset/m7-1-reusable-ci.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

feat(M7.1): sync-configs `ci` + `renovate-config` templates become thin shims

The `ci` workflow template is now a ~6-line caller of the org reusable workflow
(`reddoorla/.github/.github/workflows/ci.yml@<sha>`), and `renovate.json` is a
3-line shim that `extends` the org preset (`github>reddoorla/.github:renovate-config`).
The canonical CI gate and dependency policy now live once in `reddoorla/.github`;
Renovate keeps the SHA current. `self-updating` requires the new `ci / ci` check context.
```

- [ ] **Step 3 — Verify the bump locally (dry)**

Run: `pnpm exec changeset status`
Expected: shows `@reddoorla/maintenance` will bump (minor).

- [ ] **Step 4 — Commit, push branch, open PR, merge to publish**

```bash
git add .changeset/m7-1-reusable-ci.md
git commit -m "chore: changeset for M7.1 thin-shim templates"
git push -u origin <branch>
gh pr create --repo reddoorla/reddoor-maintenance --base main \
  --title "feat(M7.1): thin-shim ci + renovate templates" \
  --body "Implements M7.1 stages 2-4. See docs/superpowers/plans/2026-06-08-m7-1-reusable-ci-and-renovate-preset.md"
```

After CI passes, merge. The changesets-action opens (or this merge triggers) the Version Packages PR; merge that to publish the new version.

- [ ] **Step 5 — Verify the publish**

Run: `npm view @reddoorla/maintenance version`
Expected: the new (bumped) version. Record it for Stage 5.

---

## Stage 5: Roll out to the starter (verify-first) — the empirical check-name gate

**Files:** none in-repo; operates on `reddoorla/reddoor-starter`.

- [ ] **Step 1 — Research (REQUIRED before any action)**

Re-confirm the rollout mechanism: does `sync-configs` (which writes templates to an existing repo) or `self-updating` (which also sets repo settings) own this swap? Read `src/recipes/sync-configs.ts` and `src/recipes/self-updating/index.ts`. The swap must (a) replace `.github/workflows/ci.yml` + `renovate.json` with the new thin shims, and (b) update branch protection to the new context. Decide which command does both (or run sync-configs for files + self-updating for protection). Note the fine-grained PAT cannot open PRs / set protection on `reddoorla/*` (org-move gotcha) — expect to do the PR + settings via `gh` as in the 2026-06-08 starter run.

- [ ] **Step 2 — Bump the starter to the new package version + apply the thin shims**

On a branch in `reddoorla/reddoor-starter`: `pnpm add -D @reddoorla/maintenance@^<version from Stage 4>`, then write the new `.github/workflows/ci.yml` (thin caller) and `renovate.json` (thin shim) — either by running the maintenance CLI sync against the repo or by copying the template contents. Run `pnpm format`, commit, push, open a PR via `gh`.

- [ ] **Step 3 — Read the REAL check context from the live checks API**

After the PR's CI run starts:

```bash
gh pr checks <pr> --repo reddoorla/reddoor-starter --json name,bucket
```

Expected: a check whose `name` is the actual reusable-workflow context. **Compare to the plan's `ci / ci` assumption.**

- If it matches `ci / ci`: proceed.
- If it differs (e.g. `ci / ci (ubuntu-latest)` or another form): STOP. Update `REQUIRED_CHECK` in `self-updating/index.ts` to the real value, re-run Stage 3 Steps 3-4, re-release (Stage 4), and bump the starter again. Do NOT touch any other repo until the constant is correct.

- [ ] **Step 4 — Fix the starter's branch protection to the real context, in lockstep**

```bash
gh api -X PUT repos/reddoorla/reddoor-starter/branches/main/protection -H "Accept: application/vnd.github+json" --input - <<'JSON'
{ "required_status_checks": { "strict": true, "contexts": ["<REAL CONTEXT FROM STEP 3>"] },
  "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null }
JSON
```

Expected: response lists the real context. Confirm the PR is now mergeable (its own run satisfies the new required context).

- [ ] **Step 5 — Merge and confirm green end-to-end**

Merge the starter PR. Verify: `gh run list --repo reddoorla/reddoor-starter --branch main --limit 1` shows the reusable-workflow run succeeded on `main`, and the Renovate config is valid (no Renovate config-error issue opened on next run). Record the confirmed context name — it is now the source of truth for the remaining repos.

---

## Stage 6: caltex canary (one live fleet site)

**Files:** none in-repo; operates on `reddoorla/caltex-landing`.

- [ ] **Step 1 — Research (REQUIRED before any action)**

Confirm caltex is currently self-updating (has the old inline `ci.yml` + `renovate.json` + branch protection requiring `ci`) so this is a true representative migration: `gh api repos/reddoorla/caltex-landing/branches/main/protection --jq '.required_status_checks.contexts'`. Confirm caltex auto-deploys via Netlify (the GitHub App) so we can verify a real deploy after merge.

- [ ] **Step 2 — Apply the swap via self-updating / sync + gh**

Run the chosen rollout command (from Stage 5 Step 1) against caltex. It writes the thin shims, and `self-updating` now sets branch protection to the corrected `REQUIRED_CHECK`. Open/merge the PR via `gh` (PAT limitation).

- [ ] **Step 3 — Verify the full real loop**

Confirm: PR CI runs the reusable workflow and passes; branch protection requires the real context; PR merges; Netlify produces a deploy for the merge commit (`gh api repos/reddoorla/caltex-landing/deployments` or the Netlify check on the PR). Expected: green CI → merge → successful deploy. If anything stalls, fix before Stage 7.

---

## Stage 7: Roll out to the remaining 14 fleet repos

**Files:** none in-repo.

- [ ] **Step 1 — Research (REQUIRED before any action)**

Enumerate the remaining self-updating repos and confirm none has an idiosyncratic CI (a repo with extra steps in its `ci.yml` would lose them on the swap — the reusable workflow is one-size). List them: `gh repo list reddoorla --limit 50 --json name`. Cross-check against the 9-self-updating set + starter + caltex already done. Flag any repo whose current `.github/workflows/ci.yml` differs from the old canonical inline template (those need a human decision before swapping).

- [ ] **Step 2 — Batch the swap**

For each remaining repo, run the rollout command (sync thin shims + self-updating protection to `REQUIRED_CHECK`), opening PRs via `gh`. Prefer the existing fleet iteration path (`--fleet` / per-repo loop). Auto-merge is enabled fleet-wide, so passing PRs merge themselves once the required context is satisfied.

- [ ] **Step 3 — Verify the fleet is consistent**

For every migrated repo, confirm: branch protection requires the real context (not the stale `ci`), and the latest `main` CI run (reusable workflow) is green. A repo still requiring `ci` after the swap is the failure mode the lockstep mitigation exists to prevent — fix any stragglers individually.

- [ ] **Step 4 — Update the roadmap**

Mark M7.1 done in `docs/superpowers/specs/2026-06-02-fleet-scale-roadmap.md` (note the scope extension: org Renovate preset folded in; versioning is SHA-pin + Renovate, not `@v1`). Commit via a docs PR.

---

## Self-Review (completed by plan author)

- **Spec coverage:** reusable workflow (Stage 1) ✓; thin caller + thin renovate templates (Stage 2) ✓; self-updating context change (Stage 3) ✓; package release (Stage 4) ✓; staged verify-first rollout starter→caltex→rest (Stages 5-7) ✓; testing via real caller run + template-shape tests (Stages 2, 5) ✓; the `ci → ci / ci` risk + lockstep mitigation (Stages 3, 5) ✓; org Renovate preset scope extension (Stages 1, 2) ✓.
- **Placeholder scan:** the only `<...>` markers are genuine prior-step data dependencies (action SHAs from Stage 1 Step 1; the v1.0.0 commit SHA from Stage 1 Step 5; the published version from Stage 4; the real check context from Stage 5 Step 3) — each names exactly where its value comes from. No vague "add error handling"-style placeholders.
- **Type/name consistency:** `REQUIRED_CHECK` is defined once (Stage 3 Step 2) and referenced consistently; `ConfigTemplate`/`templatesByName` match the existing `templates.ts` API; test file path and assertion helpers match the real `tests/recipes/ci-templates.test.ts`.
- **Known provisional value:** `ci / ci` is explicitly provisional and gated by the empirical read in Stage 5 Step 3, which corrects it everywhere if wrong before any fleet-wide change.
