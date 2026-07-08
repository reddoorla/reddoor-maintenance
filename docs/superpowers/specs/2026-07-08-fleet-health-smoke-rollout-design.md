# Fleet /health + Smoke Rollout — Design

**Goal:** Propagate the starter's `/health` endpoint and smoke suite onto the existing production fleet via two idempotent, heterogeneity-resilient recipes, so the Report Health Gate has real signal fleet-wide instead of blocking every site's Maintenance report on `unknown`.

**Context:** The Report Health Gate (built, on branch `autotick-coverage-extension`) reads `function-health` — a fetch of each site's deployed `/health` — for both "Deploy & Function Health" and "CMS Checked". `/health` and the smoke suite are new in `reddoor-starter`; new sites inherit them, but the ~10 existing sites don't have them. Until they do, `function-health` 404s → `skip` → `unknown` → the gate blocks (fail-safe working as designed). This rollout closes that gap.

**Non-goal:** Running the recipes against the fleet, pushing branches, or merging. The recipes produce a branch + commit per site checkout (via `withRecipe`); reviewing/pushing/merging those branches is a RED-tier operator step, exactly like every other recipe.

---

## Architecture

Two focused, single-responsibility recipes, both modeled on `a11y-fixtures-page` (idempotent template injection through the `withRecipe` framework: branch-per-site, commit accumulation, safe restore-on-failure, noop-on-dirty-tree). Both are registered as `RecipeName`s + standalone CLI commands, and both are appended to the `init` onboarding chain so new sites keep inheriting them.

Delivered independently so `/health` (low-risk) can land on a site even if `smoke-suite` (higher-risk) noops there.

### Recipe 1 — `health-endpoint`

Writes `src/routes/health/+server.ts` from a **resilient** template. Noop if the file already exists (never clobber operator edits).

**Resilience (the core design point):** the starter template does `import { createClient, isPlaceholderRepo } from "$lib/prismicio"`. `createClient` is universal to Prismic SvelteKit sites, but `isPlaceholderRepo` is a newer starter export — a static import of a missing named export **breaks the Vite build** on older clones. The template therefore uses `import * as prismicio from "$lib/prismicio"` and feature-detects:

- `isPlaceholderRepo` → `prismicio.isPlaceholderRepo ?? false` (absent ⇒ not a placeholder).
- `createClient` → if not a function, return `prismic: "skipped"` (⇒ CMS "never ran"; the gate keeps blocking rather than falsely greening — fail-safe).
- The Prismic probe stays wrapped in try/catch with the 5s timeout; any client error ⇒ `"error"` ⇒ reds CMS (fail-safe, never a false green).

`forms` booleans read the same env names (`FORMS_INGEST_URL`, `FORMS_INGEST_TOKEN`, `PUBLIC_TURNSTILE_SITE_KEY`); unset ⇒ `false`, harmless and informational (the gate keys off `ok` + `prismic`, not `forms`).

Emitted commit: `feat: add /health endpoint (function-health probe)`.

### Recipe 2 — `smoke-suite`

Applies the smoke suite conservatively, in this order, committing what it can and **flagging** what it can't (partial-apply):

1. **Spec files** — write `tests/smoke/routes.ts` (the safe `/`-only manifest) and `tests/smoke/pages.spec.ts` (the page-load + console-error + 404 spec, verbatim from the starter). Each is noop-if-exists.
2. **`playwright.config.ts`** — three cases:
   - **Absent** → write the starter config (shared `@reddoorla/maintenance/configs/playwright-a11y` base + `reducedMotion: "reduce"` + the R1.1 `REDDOOR_SMOKE_PORT` binding).
   - **Present + safely patchable** (recognizably the shared-base shape, missing only the R1.1 port binding) → inject the `REDDOOR_SMOKE_PORT` block.
   - **Present + unusual** (can't confirm the shape) → **noop this file + flag** `playwright.config needs manual patch` in the recipe notes. The rest still applies. (Decision: partial-apply, not whole-site fail.)
3. **`package.json` scripts** (merge, never overwrite an existing script):
   - `test:smoke` absent → `"playwright install chromium && playwright test"`.
   - `test:unit` absent → the existing `test` value if present, else `"vitest run"`.
   - `test` absent → `"vitest run"` (kept as the fast unit alias the shared CI gates on; smoke is a separate script).
4. **Deps + install** — if `@playwright/test` is absent from devDependencies, add it, then run `pnpm install` so the lockfile updates in the same commit (Decision: add + install, matching `bump-deps`). `@reddoorla/maintenance` (the config source) is already a dep on every maintained site; `@axe-core/playwright` belongs to a11y setup, out of scope here.

Emitted commit: `feat: add smoke suite (test:smoke + playwright config + /health smoke routes)`. When the config was flagged, the notes carry the manual punch-list item.

**Un-patchable beyond the config:** if the site has no `package.json` (not a node project) or is otherwise structurally unrecognizable, the whole recipe noops with a note — never a destructive write.

---

## Per-site safety posture

- **Never clobber:** every file write is noop-if-exists; every `package.json` script/dep is add-if-absent.
- **Never falsely green:** any inability to verify (missing `createClient`, probe error) resolves to a state the gate treats as block/red, never pass.
- **Never break a build unreviewed:** the recipe only stages a branch; the operator builds/reviews/deploys it (RED-tier) before it goes live, so a heterogeneity edge (e.g. a non-standard `createClient` signature reddening CMS) is caught in review, not production.
- **Partial-apply + punch-list:** a site that can't take the config change still gets `/health`, specs, and scripts, plus a flagged note telling the operator exactly what to finish by hand.

## Integration

- `src/recipes/health-endpoint/{index,template}.ts`, `src/recipes/smoke-suite/{index,template}.ts`.
- Register in `src/recipes/index.ts` (`ALL_RECIPE_NAMES`) and `src/types.ts` (`RecipeName` union).
- Standalone CLI commands in `src/cli/bin.ts` (`health-endpoint`, `smoke-suite`), mirroring the `a11y-fixtures-page` command wiring.
- Append both to `DEFAULT_INIT_STEPS` after `a11y-fixtures-page`, before the final `audit`, so new sites inherit them and `smoke-suite`'s `pnpm install` precedes the audit.

## Testing

- Unit tests per recipe with the git + spawn layers injected/mocked (no real `pnpm install`, no branch mutation, no server/browser boot — the sandbox guardrail holds; `pnpm install` runs only when the operator later applies to real checkouts).
- Fixtures for the heterogeneity matrix: `$lib/prismicio` with/without `isPlaceholderRepo`; site with/without an existing `playwright.config.ts` (patchable vs unusual); `package.json` with/without existing `test`/`test:smoke`/`@playwright/test`; a site with no `package.json` → whole-recipe noop.
- Full maintenance gate green (dual typecheck, eslint+prettier, tsup build, `test:coverage` above floors, `test:dist` import-graph).

## Resolved decisions

1. Scope — **`/health` + smoke suite** (both).
2. Config collision — **noop the config + flag for manual**, commit the rest (partial-apply).
3. Missing devDeps — **add to `package.json` + run `pnpm install`** so each branch lands install-complete.
4. Structure — **two recipes** (`health-endpoint`, `smoke-suite`), independently deliverable, both in the `init` chain.

## Out of scope

- Extending each site's `tests/smoke/routes.ts` beyond `/` (operator/`figma-slices` grows it per real routes).
- The `reddoorla/.github@45ded88` CI bump to run `test:smoke` on PRs (off-repo, RED-tier).
- Any push/merge of the produced branches (RED-tier).
