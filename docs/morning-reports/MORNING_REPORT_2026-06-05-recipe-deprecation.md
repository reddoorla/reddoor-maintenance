# Morning brief — 2026-06-05 (recipe deprecation pass)

> Second pass, written evening of 2026-06-04 via `evening-review` with a strategic lens: the fleet is fully onboarded + self-updating, new sites come from `reddoor-starter`, so re-evaluate the recipe layer for deprecation and for what to bake into the starter. Read-only run across `reddoor-maintenance` **and** `reddoor-starter`. Companion to `MORNING_REPORT_2026-06-05.md` (the recipe-hardening pass) — read this one second; it **reframes** several of last night's findings.

## The one finding that changes the strategy

**`reddoor-maintenance` and `reddoor-starter` have silently become two different, partially-incompatible definitions of "a canonical Reddoor site."** They diverged in _both_ directions:

- **The starter is RICHER than reddoor-maint's templates** where it counts: its `svelte.config.js` ships a full **CSP policy** (Prismic+Vimeo, with `/api/csp-report`), the complete **`$components/$utils/$stores/$assets` alias set**, and a **placeholder-tolerant prerender handler** (lets a fresh clone build before Prismic is wired, throws on real sites). reddoor-maint's `createSvelteConfig` template is the 6-line `adapter({edge:false,split:false})` version — **none of that richness.** Running `sync-configs` against the starter would _destroy_ the CSP, the aliases, and the prerender handler. (This is last night's H1 — the starter is its worst-case victim.)
- **The starter LACKS what reddoor-maint adds:** no `@reddoorla/maintenance` dep (it hand-rolls eslint + svelte configs), no `pnpm.onlyBuiltDependencies`, no Renovate (`renovate.json`/`renovate.yml` absent), still carries `@sveltejs/adapter-auto`, and its `dev` script still uses `npm:` prefixes.
- **The CIs are different workflows with different job names and different a11y engines.** Starter CI: job **`verify`**, a11y via native `pnpm test:a11y` (its own `playwright.config.ts` + spec), Lighthouse via native `pnpm test:lhci`, plus a `pnpm audit --audit-level=high --prod` step. Fleet CI (synced from reddoor-maint): job **`ci`**, a11y via `pnpm exec reddoor-maint audit --only a11y --fail-on-violations`, no dep-audit step.

The fleet sites follow reddoor-maint's definition; new starter clones follow the starter's. **They are concretely incompatible in at least one way that will break the next onboarding** (see H1 below). So "deprecate most recipes + wire into the starter" is the right instinct — but the actual work is **reconcile the two canonicals and pick ONE source of truth first**, then the deprecation falls out cleanly.

## Top of stack (do these first)

1. **Decide the source of truth: starter-as-canonical, or reddoor-maint-as-canonical (~30 min decision, see Decisions Deferred §1).** Everything below branches on it. My recommendation: **starter owns the site shape; reddoor-maint becomes orchestration-only** (audit-as-a-service for scheduled fleet audits + Airtable, reports/email, self-updating GitHub wiring, dashboard). It matches your instinct and the starter is already the richer artifact.
2. **Fix the `verify`-vs-`ci` CI job-name mismatch in the starter (H1, ~10 min).** Rename the starter's CI job `verify` → `ci` (or teach `self-updating` to protect the starter's actual job name). Without this, the _next_ site cloned from the starter gets branch protection waiting on a `ci` check that never runs. One-line fix, but it's a latent trap armed right now.
3. **Close the four starter gaps that make a clone "not quite born-onboarded" (H2, ~30 min):** add `pnpm.onlyBuiltDependencies` (sharp/esbuild), add `renovate.json` + the renovate workflow, drop `@sveltejs/adapter-auto`, flip the `dev` script `npm:`→`pnpm:`. These are exactly last night's H2/M2/M4 — but the fix is _in the starter_, not in recipes you're about to delete.

## Findings — HIGH

### H1 — Starter CI job is `verify`, but `self-updating` protects a check named `ci` → branch protection breaks for the next starter clone

- **Where:** `reddoor-starter/.github/workflows/ci.yml` (job `verify`, line ~9) vs `reddoor-maintenance/src/recipes/sync-configs/templates.ts:87` (`jobs: ci:`) and the branch-protection context `self-updating` requires (`ci`, verified on the 9 fleet repos: `required checks: ci`).
- **Why it matters:** A new site = clone starter → run `self-updating`. `self-updating` enables auto-merge + requires the `ci` status check. The starter's workflow only ever produces a `verify` check, so the required `ci` check is **never satisfied** → Renovate's auto-merge PRs stall forever (or branch protection is effectively un-passable). This is the concrete incompatibility between the two canonicals, and it fires on the _very next_ onboarding. (Also note the dual horn: if `self-updating`/`sync-configs` instead _overwrites_ the starter's `ci.yml` with reddoor-maint's, it silently replaces the starter's richer native a11y+lhci+dep-audit CI with the leaner one — also bad. Verify which happens.)
- **Fix sketch:** Pick the source of truth (Top of stack #1) and make the job names agree. If starter-as-canonical: rename starter job `verify`→`ci` and stop having reddoor-maint ship a `ci.yml` template. If reddoor-maint-as-canonical: the starter must consume reddoor-maint's CI (and adopt the `reddoor-maint audit` a11y path). Either way, **one CI definition.**

### H2 — `svelte.config.js` exact-overwrite is fundamentally wrong, and the starter proves it (reframes last night's H1)

- **Where:** `reddoor-maintenance/src/recipes/sync-configs.ts:30` (`isSvelteConfigCompliant`) + `templates.ts:71-73`; victim shape: `reddoor-starter/svelte.config.js`.
- **Why it matters:** Last night I framed this as "preserve `kit.prerender`." The starter shows the real scope: a canonical svelte.config legitimately carries **CSP directives, a full alias map, and custom prerender handlers** — none of which an exact-string template can preserve. The compliance-recognizer is all-or-nothing and the emitter is a strict 6-liner, so _any_ re-sync is a silent downgrade. The onboarded fleet sites are **already** on the lesser config; new starter clones are on the richer one. That gap widens every time the starter evolves.
- **Fix sketch:** This finding **dissolves if you delete the svelte.config template** (starter-as-canonical: reddoor-maint stops owning svelte.config entirely). If you keep `sync-configs` owning it, it must become a real merge (preserve `csp`, `alias`, `prerender`, `compilerOptions`, `warningFilter`) or fail-loud. Deleting it is cleaner and aligns with the deprecation goal.

## Findings — MEDIUM

### M1 — The recipe layer is mostly one-shot migration scaffolding that has done its job; ~6 of 9 recipes are deprecation candidates

Classification of `ALL_RECIPE_NAMES` (`src/recipes/index.ts:42`) through the starter-centric lens:

| Recipe               | Files                                               | Verdict                   | Why                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte-4-to-5`      | `svelte-5/` (8 step files)                          | **DEPRECATE**             | No Svelte-4 sites incoming (starter is Svelte 5); fleet already migrated. Biggest surface to shed.                                                                                                                                                            |
| `svelte-codemods`    | `svelte-5/codemods/*` (5 codemods)                  | **DEPRECATE**             | Only meaningful as part of the 4→5 migration.                                                                                                                                                                                                                 |
| `convert-to-pnpm`    | `convert-to-pnpm.ts` + `script-rewrites.ts`         | **DEPRECATE**             | Starter is pnpm; fleet converted. (Last night's H2/M4 live here → moot once deleted, but move the _fixes_ into the starter.)                                                                                                                                  |
| `a11y-fixtures-page` | `a11y-fixtures-page/`                               | **DEPRECATE**             | Starter already ships `/dev/a11y-fixtures` **and** `/dev/animate-in` + `+error.svelte`. The recipe only existed to backfill old clones.                                                                                                                       |
| `bump-deps`          | `bump-deps.ts`                                      | **DEPRECATE / demote**    | Renovate (via `self-updating`) now does routine updates. Keep only as a manual escape hatch, or drop.                                                                                                                                                         |
| `onboard`            | `onboard.ts`                                        | **SHRINK to near-zero**   | New sites born from starter already have the deps. Keep a thin path _only_ for acquiring an external non-starter repo.                                                                                                                                        |
| `init`               | `init.ts`                                           | **SHRINK / retire**       | It just chains onboard+sync-configs+codemods+a11y-fixtures — all of which are being deprecated. For a starter clone, `init` ≈ no-op.                                                                                                                          |
| `sync-configs`       | `sync-configs.ts` + `templates.ts` + `gitignore.ts` | **RECONCILE then decide** | Its config templates are the _other_ canonical that conflicts with the starter (H2). Either retire the templates (starter-as-truth) or keep it as the drift-propagation tool but fix the merge. The `gitignore` merge logic is genuinely useful and reusable. |
| `self-updating`      | `self-updating/`                                    | **KEEP**                  | GitHub repo-settings + secret wiring can't live in starter files; runs once per new repo. The one recipe that survives intact. (Still wants last night's secret-before-protection reorder.)                                                                   |

Net: of 9 recipes + ~15 supporting files, **the maintenance-relevant survivors are `self-updating` and (conditionally) `sync-configs`'s gitignore merge.** The audit/reports/dashboard/Airtable code is _not_ in the recipe layer and is unaffected. "Deprecate most of the recipes" is accurate — it's ~6 of 9 outright, 2 more shrunk to near-nothing.

### M2 — Deprecation needs a real off-ramp, not just deletion (codemods + svelte-5 are the test-coverage anchor)

- **Where:** `src/recipes/svelte-5/` + `tests/recipes/svelte-5*` / codemod tests.
- **Why it matters:** The Svelte-4→5 codemods carry a large share of the suite's 619 tests. Deleting them removes real test mass and any institutional memory of _how_ the migration was done (useful if you ever acquire a legacy non-starter site). Don't hard-delete — **move to a `legacy/` or archived package / a tagged release**, with a one-line README pointer ("if you ever onboard a pre-starter site, the migration recipes live at tag `vX`"). This keeps the maintained surface lean without losing the capability.
- **Fix sketch:** Cut a `recipes-archived` tag or move `svelte-5/` + `convert-to-pnpm/` to a `src/legacy/` excluded from the default CLI command list (`ALL_RECIPE_NAMES`), so they're not advertised but recoverable.

### M3 — The starter is private + not self-updating → it can't be the canonical reference it's meant to be

- **Where:** `gh api repos/tucksravin/reddoor-starter/branches/main/protection` → 403 (private, free plan); no `renovate.json`.
- **Why it matters:** If the starter is the source of truth, it should be the _most_ canonical repo — self-updating, CI-green, Renovate-current. Today it's private (so no branch protection, same wall as last night's espada/gallerysonder), has no Renovate, and its deps drift by hand (last commit was a manual `chore/deps-bump-202605` on 2026-05-28). A stale starter means every new clone is born stale.
- **Fix sketch:** Make the starter public (you already did this for 3 client repos tonight), add Renovate, run `self-updating` on it, and let it dogfood its own CI. The starter should be the first repo that's always green and current.

## Findings — LOW

### L1 — `RecipeName` type + CLI `--help` will advertise deprecated recipes until pruned

`src/types.ts` (`RecipeName` union) + `src/recipes/index.ts:42` + the CLI command registry. When you deprecate, prune `ALL_RECIPE_NAMES` and the union together (there's a type-test guarding drift between them — it'll catch a half-prune). Cheap, but easy to forget and leaves dead commands discoverable.

### L2 — Starter and fleet a11y coverage silently differ

Starter checks whatever routes its own `playwright.config.ts` + a11y spec enumerate; reddoor-maint's audit checks exactly `/dev/a11y-fixtures` + `/dev/animate-in` (`a11yRoutes`). After you pick one engine, confirm the route set is the same, or new sites and fleet sites get different a11y guarantees. (Minor today; matters once the two CIs are unified.)

### L3 — `.reddoor-a11y-spec-*` leak (carried from tonight's other brief)

Still applies to whichever repos run `reddoor-maint audit`. If you move new sites to native `pnpm test:a11y` (starter engine), the leak surface shrinks to just the scheduled-fleet-audit path — another point in favor of the native engine. Fix = try/finally + gitignore (see `MORNING_REPORT_2026-06-05.md` M3).

## Open loops carried forward (re-graded under the deprecation lens)

- **Last night's H1 (svelte.config clobber)** → **promoted + reframed** (H2 here). Not "preserve prerender" — the template model is wrong; the starter has CSP+aliases+prerender it would destroy. Resolve by deleting the template (starter-as-truth) or true-merge.
- **Last night's H2 (onlyBuiltDependencies in convert-to-pnpm)** → **moves to the starter.** convert-to-pnpm is being deprecated; the real gap is the _starter_ lacks `onlyBuiltDependencies` (confirmed). Fix it there (Top of stack #3).
- **Last night's M2 (onboard adapter reconcile) + M4 (convert-to-pnpm npm: rewrite)** → **mostly dissolve.** Both recipes are deprecation candidates; the residue is the starter still carrying `adapter-auto` + `npm:` scripts. Fix in the starter.
- **Last night's M1 (self-updating secret-before-protection reorder)** → **STILL STANDS, unchanged.** `self-updating` is the one recipe that survives, so its partial-failure ordering bug is now _more_ important, not less.
- **mjml advisory / stale branches / webhook M5 / STATUS_MAP** (from tonight's other brief) → unchanged; orthogonal to deprecation.

## Decisions — §1 RESOLVED 2026-06-04 (the rest still your call)

1. **Source of truth — DECIDED: shared-package model ("B-refined").** ~~Provisional lean was starter-as-canonical~~ — **overturned** once the real requirement landed: _"if I fix something on one, I fix in all"_ + all sites broadly matched + shared context (rfp/security docs) across the fleet. Evidence that settled it: `ContentWidth.svelte` is copy-pasted across repos at **78 / 28 / 7 lines** (starter / reddoor-website / gallerysonder) — already divergent, no fix-once possible; and the starter doesn't depend on `@reddoorla/maintenance` while every fleet site does. Self-contained clones (Option A) **structurally cannot** deliver fix-once. **Decision:**
   - **Starter = the clone skeleton** (per-site scaffold: routes, content, app.html). Stays the clone source.
   - **A shared package = the "shared brain"** that all sites _including the starter_ depend on: `createSvelteConfig` (ported up to the starter's CSP + alias + prerender richness), `createEslintConfig`, shared **components** (ContentWidth/Nav/Footer scaffold), shared utils, and shared **docs/context** (rfp/accessibility/security).
   - **Propagation = Renovate + `self-updating`** (already live on all 9 repos): fix in the package → publish → every site auto-bumps. Fix once, apply all.
   - **One CI** via a reusable GitHub Actions workflow (also collapses the `verify`-vs-`ci` mismatch in H1).
   - reddoor-maint does **not** shrink to orchestration-only — it **grows** into the shared-package role (plus orchestration). The config/component/template core is the asset, not the liability. The migration recipes (M1 table) still get deprecated — orthogonal.
   - **Cost / the one real project:** extract the divergent copy-pasted components into the package (pick canonical versions). See the roadmap milestone **M7 — Shared-package extraction** (`docs/superpowers/specs/2026-06-02-fleet-scale-roadmap.md`).
   - **Open sub-decisions (gate M7, need a focused brainstorm):** (a) extend `@reddoorla/maintenance` vs split a sibling `@reddoorla/ui` for the Svelte components (different release cadence + peer deps); (b) the component override/props API for per-site customization.
2. **a11y/lighthouse engine: native (starter's `pnpm test:a11y`/`test:lhci`) vs `reddoor-maint audit`.** Provisional: **native in CI, reddoor-maint audit for scheduled fleet runs.** Per-PR CI uses the starter's native playwright/lhci (no reddoor-maint dep needed in client repos); reddoor-maint's `audit` stays for the _scheduled, Airtable-writing, fleet-wide_ runs (M2 of the roadmap), which is a genuinely different job. This cleanly separates "gate this PR" from "audit the fleet on a schedule."
3. **Hard-delete vs archive the migration recipes.** Provisional: **archive** (tag or `src/legacy/`), don't delete — preserves the capability for a rare legacy acquisition and keeps the test history recoverable (M2).
4. **Reconcile the roadmap.** The standing `fleet-scale-vision-2026-06` memory + roadmap assume reddoor-maint clones/orchestrates everything and onboarding is a central concern. This pass says onboarding is mostly _solved by the starter_, and reddoor-maint should shed the onboarding/migration half. That's a meaningful roadmap edit (M1 "git/CI foundation" largely shipped; the recipe-hardening sub-thread is now mostly "delete, don't harden"). Worth a roadmap revision once §1 is decided.

## What I did NOT do tonight

Read-only review per the skill, across **both** `reddoor-maintenance` and `reddoor-starter`. **No commits, PRs, pushes, deletions, Airtable/Netlify/GitHub-settings changes** to either repo. No recipes were deprecated or moved — this brief only _proposes_ the plan. The 9 self-updating fleet repos and the starter are untouched. Local `reddoor-maintenance` is still 3 behind `origin/main` (did not pull). Setup writes done before the all-clear (while you were present): the `.claude/settings.local.json` allowlist additions (new brief path + `reddoor-starter` read access) and this file. No source touched in either repo.
