# Fleet /health + Smoke Rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two idempotent, heterogeneity-resilient recipes (`health-endpoint`, `smoke-suite`) that propagate the starter's `/health` endpoint + smoke suite onto existing sites, so the Report Health Gate has real signal fleet-wide.

**Architecture:** Model both on `a11y-fixtures-page` (template injection via `withRecipe`: branch-per-site, commit accumulation, safe restore, noop-on-dirty). Register each as a `RecipeName`, a standalone `--fleet` CLI command (mirroring `svelte-codemods`), and a `DEFAULT_INIT_STEPS` step. Branch+commit per site; never push (RED-tier).

**Tech Stack:** TypeScript (NodeNext — relative imports need `.js`), vitest, tsup. Repo gate: `pnpm typecheck` (dual tsconfig), `pnpm lint` (eslint + prettier), `pnpm build`, `pnpm test:coverage` (floors: statements 78 / branches 67 / functions 76 / lines 80), `pnpm test:dist`.

**Reference files (read before starting):**

- `src/recipes/a11y-fixtures-page/{index,template}.ts` — the recipe pattern to mirror.
- `src/recipes/_with-recipe.ts` — `withRecipe`, `RecipePlan`, `RecipeApplyCtx`.
- `src/cli/commands/svelte-codemods.ts` — single-recipe fleet-dispatch command module.
- `src/cli/bin.ts:254-286` — the `svelte-codemods` `.command()` block to mirror; `:50-62` `RECIPE_DESCRIPTIONS`.
- `src/recipes/init.ts` — `recipeStep` + `DEFAULT_INIT_STEPS`.
- `src/util/git.ts` — `commit`, `isWorkingTreeClean` (already used by `withRecipe`).
- `src/audits/util/spawn.ts` — `defaultSpawn` (for the `pnpm install` step; inject in tests).

**Guardrails:**

- NEVER run `pnpm install`, `playwright`, or boot any dev server/browser during the build. All spawn/git effects are dependency-injected and mocked in tests. `pnpm install` runs only when the operator later applies the recipe to real checkouts.
- Every file write is noop-if-exists. Every `package.json` script/dep is add-if-absent. Never overwrite an existing script or an existing `playwright.config.ts`.
- NodeNext: all relative imports end in `.js`.

---

## Task 1: `health-endpoint` template

**Files:**

- Create: `src/recipes/health-endpoint/template.ts`

- [ ] **Step 1: Write the template module**

The resilient `/health` — feature-detects `$lib/prismicio` so it builds on older clones lacking `isPlaceholderRepo`.

```ts
/** Relative path inside a site where the /health endpoint lives. Deploys as a
 * Netlify function (adapter-netlify v6); the function-health audit fetches it. */
export const HEALTH_ENDPOINT_RELATIVE = "src/routes/health/+server.ts";

/** Resilient /health for existing sites. Unlike the starter's, it does NOT
 * statically import { createClient, isPlaceholderRepo } from "$lib/prismicio" —
 * older clones lack `isPlaceholderRepo`, and a missing named import breaks the
 * Vite build. Instead it namespace-imports and feature-detects: `createClient`
 * is universal to Prismic SvelteKit sites; a missing one => prismic:"skipped"
 * (the gate treats CMS as "never ran" and keeps blocking — never a false green).
 * Any probe error => "error" (reds CMS, fail-safe). The gate keys off ok + prismic. */
export const HEALTH_ENDPOINT_TEMPLATE = `import { json } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import * as prismicio from "$lib/prismicio";
import type { RequestHandler } from "./$types";

// A live probe — must never be prerendered.
export const prerender = false;

type PrismicHealth = "ok" | "error" | "skipped";

type PrismicClient = { getRepository: () => Promise<unknown> };
type PrismicModule = {
  createClient?: (opts: { fetch: typeof globalThis.fetch }) => PrismicClient;
  isPlaceholderRepo?: boolean;
};

// Server-side Prismic reachability probe. Hits the PUBLIC repository-metadata
// endpoint (getRepository — no token), time-boxed, returning ONLY a status
// string; the repository body is never included (/health is public).
async function probePrismic(fetch: typeof globalThis.fetch): Promise<PrismicHealth> {
  const mod = prismicio as PrismicModule;
  const isPlaceholder = mod.isPlaceholderRepo ?? false;
  if (isPlaceholder || typeof mod.createClient !== "function") return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = mod.createClient({ fetch });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("prismic health probe timed out")), 5000);
    });
    await Promise.race([client.getRepository(), timeout]);
    return "ok";
  } catch {
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const GET: RequestHandler = async ({ fetch }) => {
  const prismic = await probePrismic(fetch);
  const forms = {
    ingestUrl: !!privateEnv.FORMS_INGEST_URL,
    ingestToken: !!privateEnv.FORMS_INGEST_TOKEN,
    turnstile: !!publicEnv.PUBLIC_TURNSTILE_SITE_KEY?.trim(),
  };
  // We're inside the handler, so the function ran; ok is false only when the
  // Prismic probe actively errored.
  const ok = prismic !== "error";
  return json({ ok, prismic, forms });
};
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/recipes/health-endpoint/template.ts
git commit -m "feat(recipes): health-endpoint template (resilient /health)"
```

---

## Task 2: `health-endpoint` recipe

**Files:**

- Create: `src/recipes/health-endpoint/index.ts`
- Test: `tests/recipes/health-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror `tests/recipes/a11y-fixtures-page.test.ts` if present; otherwise test through `withRecipe` with an injected temp git repo, or (simpler) unit-test the plan/apply by pointing `site.path` at a temp dir. Assert: (a) writes `src/routes/health/+server.ts` with the template when absent → status `applied`; (b) noop when the file already exists; (c) the written content equals `HEALTH_ENDPOINT_TEMPLATE`.

Use the same test harness the existing recipe tests use (check `tests/recipes/` for the established temp-git fixture helper — reuse it, do not invent a new one).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/recipes/health-endpoint.test.ts --no-coverage`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the recipe** (verbatim shape of `a11yFixturesPage`)

```ts
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { HEALTH_ENDPOINT_RELATIVE, HEALTH_ENDPOINT_TEMPLATE } from "./template.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a resilient `src/routes/health/+server.ts` if the route doesn't already
 * exist. The function-health audit fetches this endpoint; existing sites need it
 * or the Report Health Gate blocks their Maintenance reports on "unknown". Operator
 * edits to an existing endpoint are never clobbered (noop on existing file).
 */
export async function healthEndpoint(site: Site): Promise<RecipeResult> {
  const target = join(site.path, HEALTH_ENDPOINT_RELATIVE);
  return withRecipe<{ target: string }>({
    name: "health-endpoint",
    site,
    plan: async () => {
      if (await fileExists(target)) {
        return { kind: "noop", notes: `${HEALTH_ENDPOINT_RELATIVE} already exists` };
      }
      return { kind: "apply", plan: { target } };
    },
    apply: async (planned, { commit }) => {
      await mkdir(dirname(planned.target), { recursive: true });
      await writeFile(planned.target, HEALTH_ENDPOINT_TEMPLATE, "utf-8");
      await commit("feat: add /health endpoint (function-health probe)");
      return { kind: "ok" };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/recipes/health-endpoint.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recipes/health-endpoint/index.ts tests/recipes/health-endpoint.test.ts
git commit -m "feat(recipes): health-endpoint recipe (noop-if-exists)"
```

---

## Task 3: Register `health-endpoint` (type + index + CLI + init)

**Files:**

- Modify: `src/types.ts` (RecipeName union)
- Modify: `src/recipes/index.ts` (import/export/ALL_RECIPE_NAMES)
- Modify: `src/cli/bin.ts` (RECIPE_DESCRIPTIONS + `.command()` block)
- Create: `src/cli/commands/health-endpoint.ts`
- Modify: `src/recipes/init.ts` (DEFAULT_INIT_STEPS + docstring)
- Test: `tests/cli/commands/health-endpoint.test.ts` (mirror an existing command test)

- [ ] **Step 1:** Add `"health-endpoint"` to the `RecipeName` union in `src/types.ts` (after `"a11y-fixtures-page"`).

- [ ] **Step 2:** In `src/recipes/index.ts`: `import { healthEndpoint } from "./health-endpoint/index.js";`, add `healthEndpoint` to the value `export { ... }`, and add `"health-endpoint"` to `ALL_RECIPE_NAMES`.

- [ ] **Step 3:** In `src/cli/bin.ts`: add the `RECIPE_DESCRIPTIONS` entry `"health-endpoint": "Write src/routes/health/+server.ts (function-health probe for the report gate)."` (the Record is exhaustive over RecipeName — typecheck fails without it). Add a `.command("health-endpoint [site]", ...)` block with `--fleet`/`--workdir` options mirroring `svelte-codemods` (bin.ts:272-286), dispatching to `./commands/health-endpoint.js`.

- [ ] **Step 4:** Create `src/cli/commands/health-endpoint.ts` — copy `svelte-codemods.ts` verbatim, swapping the import to `healthEndpoint`, the recipe name string to `"health-endpoint"`, and the `runRecipeOverSites("health-endpoint", sites, (s) => healthEndpoint(s))` call. Rename the exported fn to `runHealthEndpointCommand` and options type to `HealthEndpointCommandOptions`.

- [ ] **Step 5:** In `src/recipes/init.ts`: import `healthEndpoint`, insert `recipeStep("health-endpoint", healthEndpoint),` into `DEFAULT_INIT_STEPS` right after the `a11y-fixtures-page` step, and update the docstring chain list. (Task 8 will add `smoke-suite` after it and update the bin.ts init description strings; leave those for Task 8 to avoid churn — but if a `DEFAULT_INIT_STEPS` test asserts the exact ordered list, update that test now.)

- [ ] **Step 6:** Add a command test mirroring an existing `tests/cli/commands/*.test.ts` (mock `resolveSites`/`runRecipeOverSites` or the recipe fn; assert single-site + `--fleet` dispatch and exit code). Run it green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(recipes): register health-endpoint (type, index, CLI --fleet, init step)"
```

---

## Task 4: `smoke-suite` templates

**Files:**

- Create: `src/recipes/smoke-suite/template.ts`

- [ ] **Step 1: Write the templates module.** Export:
  - `SMOKE_ROUTES_RELATIVE = "tests/smoke/routes.ts"` + `SMOKE_ROUTES_TEMPLATE` = the starter's `tests/smoke/routes.ts` verbatim.
  - `SMOKE_SPEC_RELATIVE = "tests/smoke/pages.spec.ts"` + `SMOKE_SPEC_TEMPLATE` = the starter's `tests/smoke/pages.spec.ts` verbatim.
  - `PLAYWRIGHT_CONFIG_RELATIVE = "playwright.config.ts"`.
  - `PLAYWRIGHT_CONFIG_TEMPLATE` = the starter's **R1.1** `playwright.config.ts` (the version that reads `REDDOOR_SMOKE_PORT` and binds `--strictPort`; copy from `reddoor-starter/playwright.config.ts` at commit 0377178).
  - `PLAYWRIGHT_CONFIG_PRE_R11` = the starter's **pre-R1.1** config (the `{ ...base, use: { ...base.use, reducedMotion: "reduce" } }` version, no port block) — used to safe-replace a recognized existing config in Task 6.

Copy all four bodies verbatim from the reddoor-starter working tree (do not paraphrase — byte-fidelity matters for the smoke spec and the safe-replace check).

- [ ] **Step 2: Commit**

```bash
git add src/recipes/smoke-suite/template.ts
git commit -m "feat(recipes): smoke-suite templates (routes, spec, playwright config)"
```

---

## Task 5: `smoke-suite` recipe — spec files + package.json + deps

**Files:**

- Create: `src/recipes/smoke-suite/index.ts`
- Test: `tests/recipes/smoke-suite.test.ts`

Define a `SmokeSuiteDeps` with an injectable `spawn` (default `defaultSpawn` from `../../audits/util/spawn.js`) so `pnpm install` is mockable. Signature: `smokeSuite(site: Site, deps: SmokeSuiteDeps = { spawn: defaultSpawn }): Promise<RecipeResult>`.

- [ ] **Step 1: Write failing tests** for this task's scope (config handling is Task 6):
  - No `package.json` at `site.path` → whole recipe `noop` with a note (not a project).
  - Writes `tests/smoke/routes.ts` + `tests/smoke/pages.spec.ts` when absent; noop-if-exists for each.
  - `package.json` scripts merge (add-if-absent, never overwrite): `test:smoke` → `"playwright install chromium && playwright test"`; `test:unit` → existing `test` value if present else `"vitest run"`; `test` → `"vitest run"` if absent. An existing `test:smoke`/`test:unit`/`test` is left untouched.
  - Deps: `@playwright/test` absent from devDependencies → added; then `spawn("pnpm", ["install"], { cwd: site.path })` is called exactly once. If `@playwright/test` already present → `spawn` NOT called.
  - Uses the shared temp-git recipe fixture; inject a fake `spawn` returning `{ code: 0 }`.

- [ ] **Step 2: Run tests → FAIL** (`pnpm exec vitest run tests/recipes/smoke-suite.test.ts --no-coverage`).

- [ ] **Step 3: Implement** through `withRecipe`. In `plan()`: if no `package.json` → `{ kind: "noop", notes: "no package.json (not a node project)" }`; else read `package.json` + existing files + existing `playwright.config.ts` state, return `{ kind: "apply", plan: {...} }`. In `apply()`:
  1. Write the two spec files if absent (`mkdir -p tests/smoke`).
  2. Merge `package.json` scripts + add `@playwright/test` to devDependencies if absent (preserve key order/formatting as much as practical; write with a trailing newline).
  3. Playwright config (Task 6 fills this in — leave a typed placeholder that always flags for now so this task's tests pass, then Task 6 replaces it).
  4. If deps changed → `await deps.spawn("pnpm", ["install"], { cwd: ctx.cwd })`; on non-zero exit return `{ kind: "failed", notes: "pnpm install failed" }`.
  5. `commit("feat: add smoke suite (test:smoke + /health smoke routes)")`.
  6. Return `{ kind: "ok", notes }` — carry any flags from Task 6 in `notes`.

- [ ] **Step 4: Run tests → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/recipes/smoke-suite/index.ts tests/recipes/smoke-suite.test.ts
git commit -m "feat(recipes): smoke-suite core (spec files, package.json merge, deps + install)"
```

---

## Task 6: `smoke-suite` — playwright.config collision handling

**Files:**

- Modify: `src/recipes/smoke-suite/index.ts`
- Test: `tests/recipes/smoke-suite.test.ts`

Never edit an existing config in place. Four cases:

- [ ] **Step 1: Write failing tests:**
  - Config **absent** → write `PLAYWRIGHT_CONFIG_TEMPLATE` (R1.1). status `applied`, no flag.
  - Config present and its trimmed content equals `PLAYWRIGHT_CONFIG_PRE_R11` → safe-replace with `PLAYWRIGHT_CONFIG_TEMPLATE` (recognized canonical file). No flag.
  - Config present and already contains `REDDOOR_SMOKE_PORT` → leave it; no flag (already R1.1).
  - Config present, unrecognized, no `REDDOOR_SMOKE_PORT` → **do not touch it**; add note `playwright.config.ts exists without REDDOOR_SMOKE_PORT — add the R1.1 port block manually`. The rest of the recipe still applies + commits (partial-apply). status `applied` with the flagged note.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the four-case branch in `apply()`, replacing the Task 5 placeholder. Read the file if it exists; compare `content.trim() === PLAYWRIGHT_CONFIG_PRE_R11.trim()` for the safe-replace; `content.includes("REDDOOR_SMOKE_PORT")` for the already-done case; else flag. Accumulate the flag string into the recipe `notes`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(recipes): smoke-suite playwright.config handling (write/replace/noop+flag)"
```

---

## Task 7: Register `smoke-suite` (type + index + CLI)

**Files:**

- Modify: `src/types.ts`, `src/recipes/index.ts`, `src/cli/bin.ts`
- Create: `src/cli/commands/smoke-suite.ts`
- Test: `tests/cli/commands/smoke-suite.test.ts`

- [ ] **Step 1:** Add `"smoke-suite"` to `RecipeName`.
- [ ] **Step 2:** `src/recipes/index.ts`: import/export `smokeSuite`, add `"smoke-suite"` to `ALL_RECIPE_NAMES`.
- [ ] **Step 3:** `src/cli/bin.ts`: `RECIPE_DESCRIPTIONS["smoke-suite"] = "Add the smoke suite (test:smoke + playwright config + /health smoke routes)."` + a `.command("smoke-suite [site]", ...)` block mirroring `svelte-codemods`, dispatching to `./commands/smoke-suite.js`.
- [ ] **Step 4:** Create `src/cli/commands/smoke-suite.ts` mirroring `svelte-codemods.ts` (`runSmokeSuiteCommand`, `runRecipeOverSites("smoke-suite", sites, (s) => smokeSuite(s))`).
- [ ] **Step 5:** Command test mirroring Task 3's. Run green.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(recipes): register smoke-suite (type, index, CLI --fleet)"
```

---

## Task 8: init-chain integration + descriptions

**Files:**

- Modify: `src/recipes/init.ts` (add `smoke-suite` step + docstring)
- Modify: `src/cli/bin.ts` (init command description strings at ~:62 and ~:319)
- Test: `tests/recipes/init.test.ts` (if it asserts the step list)

- [ ] **Step 1:** In `DEFAULT_INIT_STEPS`, insert `recipeStep("smoke-suite", smokeSuite),` after the `health-endpoint` step (order: … a11y-fixtures-page → health-endpoint → smoke-suite → audit) so `pnpm install` precedes the audit. Update the init.ts docstring chain.
- [ ] **Step 2:** Update the two init description strings in `bin.ts` (`RECIPE_DESCRIPTIONS.init` and the `init [site]` command) to include `→ health-endpoint → smoke-suite`.
- [ ] **Step 3:** Update/extend `tests/recipes/init.test.ts` for the new default steps if it asserts them. Run green.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(recipes): add health-endpoint + smoke-suite to the init chain"
```

---

## Task 9: Full-gate verification

- [ ] **Step 1:** `pnpm typecheck` → both tsconfigs clean.
- [ ] **Step 2:** `pnpm lint` → eslint + prettier clean (run `pnpm format` if needed).
- [ ] **Step 3:** `pnpm build` → tsup clean.
- [ ] **Step 4:** `pnpm test:coverage` → all pass, coverage above floors. (Local quirk: if the globalSetup stale-dist rebuild trips a pre-existing TS2883 in `src/reports/airtable/client.ts` under typescript@6.x, `touch dist/cli/bin.js` then re-run — it does NOT occur in CI.)
- [ ] **Step 5:** `pnpm test:dist` → import-graph smoke OK (the new recipe/command modules must not pull central-only packages into an audit import path; they're recipes, so this should hold — verify).
- [ ] **Step 6:** Confirm working tree clean; the branch is a stack of small commits ready for review.

---

## Self-review checklist (controller, before final review)

- Both recipes noop-if-exists on every file; no `package.json` script/dep is ever overwritten.
- `PLAYWRIGHT_CONFIG_TEMPLATE` is the **R1.1** version; `PLAYWRIGHT_CONFIG_PRE_R11` matches what a pre-R1.1 shared-base adopter has (for safe-replace only).
- `pnpm install` is dependency-injected and mocked in every test — no real install, no server/browser boot anywhere in the suite.
- `RECIPE_DESCRIPTIONS` (exhaustive Record) has both new entries; `RecipeName`, `ALL_RECIPE_NAMES`, `index.ts` exports, and `DEFAULT_INIT_STEPS` all include both recipes.
- Delivery is branch+commit per site; nothing pushes.
