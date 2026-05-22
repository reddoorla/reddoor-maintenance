# @reddoorla/maintenance

## 0.6.1

### Patch Changes

- 421a757: Two codemod fixes surfaced by the caltex 0.6.0 pilot — sites failed to build with `Cannot use $$props in runes mode`.

  ### `dollarPropsClass` (new codemod)

  Converts the legacy `$$props.class` pattern (extra HTML class passed from a parent) to a Svelte 5 named-prop destructuring:

  ```svelte
  <!-- before -->
  <script lang="ts">
    let { foo }: { foo?: string } = $props();
  </script>
  <div class="other {$$props.class || ''}">x</div>

  <!-- after -->
  <script lang="ts">
    let { foo, class: className = "" }: { foo?: string; class?: string } = $props();
  </script>
  <div class="other {className || ''}">x</div>
  ```

  The original `svelte-migrate` tool flagged this with `@migration-task` comments because it can't safely combine `$$props` with named props in general. We can for the `class` case specifically — it's the dominant pattern across the reddoor fleet. The codemod also strips those stale `@migration-task` comments when the file's `$$props` issues are fully resolved.

  Conservative match — only transforms files that have BOTH a template `$$props.class` reference AND an existing `$props()` destructuring. Lazy regex backtracking on the destructuring body so default values containing braces (`click = () => {}`, `config = { x: 1 }`) and type annotations containing braces (`items: string[]|{label:string}[]`) don't truncate the match.

  ### `exportLetToProps` (relaxed)

  Previously only matched `<script lang="ts">` blocks. Now matches plain `<script>` too, emitting destructuring without a type annotation. Picks up Svelte 4 → 5 conversions the original migration skipped (caltex's `ArrowButton` was the immediate find).

  ### Re-running

  Sites that already had 0.6.0 codemods applied can safely re-run `reddoor-maint svelte-codemods` — the new codemods are additive and the existing ones are idempotent.

## 0.6.0

### Minor Changes

- 020f511: Add `svelte-codemods` recipe + `state_referenced_locally` codemod.

  Discovered during the caltex 0.5.0 pilot: Svelte 5's `state_referenced_locally` warning flags real reactivity bugs where `let X = $state(prop.expr)` captures a prop only at init time. The same shape appeared in 6+ caltex route files (and likely across the fleet) — a copy-pasted manual-sync pattern:

  ```js
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => {
    data;
    content = data.page.data;
  });
  ```

  ### `stateEffectSyncToDerived` codemod

  New gotcha codemod that collapses the pattern above into the idiomatic Svelte 5 form:

  ```js
  let content = $derived(data.page.data);
  ```

  Joins the existing `onEventToHandler`, `exportLetToProps`, and `removeDollarRestProps` codemods in the gotchas pipeline. Conservative match: only transforms when the `$state(...)` initializer expression and the `$effect`'s assignment expression are textually identical (after trim). Intervening statements between the two block the match. Idempotent.

  ### `svelte-codemods` standalone recipe

  The full `svelte-4-to-5` recipe short-circuits sites already on `svelte ^5.x`. The new `svelte-codemods` recipe runs the same codemod pass on its own — useful when post-migration Svelte 5 strictness warnings emerge and the fleet needs a clean re-application.

  ```sh
  reddoor-maint svelte-codemods /path/to/site
  ```

  Creates a `maint/svelte-codemods-<ts>` branch with one commit: `refactor(svelte5): apply codemods (N files)`. Plans in memory first — no branch is created if the codemods would be a noop, so re-runs are cheap.

  ### Internal refactor

  `applyGotchaCodemods` now delegates to a new `planGotchaCodemods` that returns the change set without writing. `svelte-4-to-5`'s pipeline keeps the existing write-on-apply behavior; `svelte-codemods` uses the plan/apply split to short-circuit cleanly on noop.

## 0.5.0

### Minor Changes

- fb81d1c: `sync-configs` now manages `.gitignore` across the fleet and untracks build artifacts.

  A new canonical config target — `gitignore` — joins the five existing ones (`eslint`, `prettier`, `lighthouse`, `playwright-a11y`, `svelte`). Unlike the others, it **merges** rather than overwrites: the recipe layers in any missing canonical entries while leaving site-specific lines (custom dirs, editor files, OS junk) untouched.

  In the same commit, the recipe also runs `git rm -r --cached` for any tracked paths that fall under a canonical _directory_ entry — typically `build/`, `dist/`, `.svelte-kit/`, `coverage/`, `playwright-report/`, `test-results/`, `.lighthouseci/`, `.vercel/`, `.netlify/`, `node_modules/`. So sites that accidentally committed build output (espada has, caltex has) get cleaned up the next time sync-configs runs.

  ### Canonical entries

  ```gitignore
  node_modules/
  build/
  dist/
  .svelte-kit/
  coverage/
  .vitest-cache/
  playwright-report/
  test-results/
  .lighthouseci/
  .tsbuildinfo
  .env
  .env.*
  !.env.example
  .DS_Store
  *.log
  .vercel/
  .netlify/
  ```

  File-pattern entries (`.env`, `*.log`, `.DS_Store`, `.tsbuildinfo`) are **not** auto-untracked. They may contain user-meaningful data, and `git rm --cached` cannot scrub secrets from history regardless. Surfaced via the `.gitignore` rule itself; manual cleanup if needed.

  ### Merge semantics
  - Existing entries in any normalized form (`build`, `/build`, `build/`, `/build/`) count as present — no duplicates appended.
  - Blank lines and comments are preserved.
  - Missing canonical entries are appended under a `# canonical entries from @reddoorla/maintenance sync-configs` marker.
  - All-present → noop, no commit.

  ### Re-running against onboarded sites

  Sites previously synced under ≤ 0.4.0 will see one new commit: `chore: sync gitignore from @reddoorla/maintenance` — adds the rule, untracks any matching build artifacts. Idempotent: re-running is a noop.

  ### CLI

  ```sh
  # whole site (all six config targets)
  reddoor-maint sync-configs /path/to/site

  # just the gitignore + untrack pass
  reddoor-maint sync-configs /path/to/site --only gitignore
  ```

## 0.4.0

### Minor Changes

- 5e08fe0: Add `createSvelteConfig` helper and svelte.config.js to sync-configs templates.

  Discovered during the caltex pilot: Svelte 5 emits `element_invalid_self_closing_tag` for the `<div ... />` shorthand reddoor codebases use everywhere. Across a fleet this drowns out useful warnings; silencing it once per site was repetitive.

  ### `createSvelteConfig`

  New canonical helper exported from `@reddoorla/maintenance/configs/svelte`. Wraps a site's existing config and layers in the canonical `compilerOptions.warningFilter`, which silences `element_invalid_self_closing_tag`. Composes cleanly with any site-provided filter — both must allow a warning for it to show.

  ```js
  // svelte.config.js
  import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
  import adapter from "@sveltejs/adapter-auto";

  export default createSvelteConfig({
    kit: { adapter: adapter() },
  });
  ```

  ### sync-configs now includes svelte

  The recipe now writes a canonical `svelte.config.js` using `createSvelteConfig` + `adapter-auto`. Sites already on `adapter-auto` (most reddoor sites) get clean syncs. Sites using a different adapter need to edit after sync.

  The new template intentionally **drops** `preprocess: vitePreprocess()` since Svelte 5 no longer needs it. Sites carrying that legacy preprocess setting are quietly modernized during sync.

  ### Re-running sync-configs against onboarded sites

  Sites previously synced under ≤ 0.3.0 will see a new commit for `svelte.config.js` on the next run. Idempotent: re-running again is a noop.

## 0.3.0

### Minor Changes

- 00081f3: Add `onboard` recipe + CLI command for first-time fleet enrollment.

  After running `convert-to-pnpm` to get a site onto pnpm, the next missing piece was: how does the site actually get the deps it needs to run audits? Discovered during the espada pilot — running `sync-configs` against a site missing `@reddoorla/maintenance`, `@lhci/cli`, `@playwright/test`, or `@axe-core/playwright` would land template files that immediately broke at runtime.

  `onboard` closes that gap. It:
  - Adds `@reddoorla/maintenance` as a devDep at the current minor range (`^0.2.0`) if not present
  - Adds the canonical audit deps (`@lhci/cli`, `@playwright/test`, `@axe-core/playwright`) at baseline versions
  - Runs `pnpm install` with streaming output
  - Commits the resulting package.json + pnpm-lock.yaml as one logical change

  Idempotent: returns `noop` when everything is already declared. Refuses on dirty trees. Pre-flights for `pnpm-lock.yaml` and returns `failed` with `"run convert-to-pnpm first"` if absent.

  CLI: `reddoor-maint onboard [site]` with `--audits lighthouse,a11y` to subset (default = both) and `--fleet <inventory>` for batch onboarding.

  Library: `onboard(site, { audits?, packageVersion?, spawn? })` exported from the package.

  ### Recommended workflow for new fleet sites

  ```bash
  reddoor-maint convert-to-pnpm /path/to/site   # if site is on npm/yarn
  reddoor-maint onboard /path/to/site            # install deps
  reddoor-maint sync-configs /path/to/site       # write canonical configs
  reddoor-maint audit /path/to/site              # verify
  ```

## 0.2.0

### Minor Changes

- 366f389: Add `convert-to-pnpm` recipe + CLI command to migrate npm/yarn sites onto pnpm. Also fixes canonical configs to use portable start commands.

  ### New: `convert-to-pnpm` recipe

  For sites still using `package-lock.json` (or `yarn.lock`). Idempotent and branch-isolated like every other recipe:
  - Detects `pnpm-lock.yaml` → returns `noop`
  - Otherwise: removes `package-lock.json` + `yarn.lock`, pins `packageManager: "pnpm@<version>"` in `package.json`, rewrites `npm run X` → `pnpm run X` and `npx X` → `pnpm dlx X` in scripts, runs `pnpm install`, commits the resulting `pnpm-lock.yaml`.
  - Three commits per applied run (lockfile removal, packageManager + script rewrites, new pnpm-lock).
  - Returns `failed` (with the branch preserved for inspection) if `pnpm install` errors.

  CLI: `reddoor-maint convert-to-pnpm [site]` or with `--fleet` for batch conversion.

  Library: `convertToPnpm(site, { spawn?, pnpmVersion? })`.

  ### Fix: canonical configs use portable `npm run vite:dev`

  Both `src/configs/lighthouse.ts` (`startServerCommand`) and `src/configs/playwright-a11y.ts` (`webServer.command`) previously hardcoded `pnpm vite:dev`. After sync-configs landed on an npm site, lhci and Playwright would fail to start the dev server. `npm run vite:dev` works on both pnpm and npm sites with no downside.

  ### Script rewriter is conservative on purpose
  - Touches `npm run <name>` and `npx <token>` (identical semantics under pnpm)
  - Skips bare `npm install`, hyphenated names like `npm-check-updates`, and concurrently's `"npm:scriptName"` shorthand

## 0.1.3

### Patch Changes

- 4939cc5: Fix security audit silently reporting `pass` for npm-using sites (no pnpm-lock.yaml).

  When pnpm was installed but the project had no pnpm-lock.yaml, pnpm audit emitted an error envelope (`{ "error": { "code": "ERR_PNPM_AUDIT_NO_LOCKFILE", ... } }`) and exit code 1. The audit treated that as valid output, read `metadata.vulnerabilities` as undefined → defaulted every count to 0 → returned `pass`. Every npm-using site in a fleet was reported as security-clean.

  Discovered while piloting against an npm-using reddoor site (espada): the site has 9 real CVEs (3 high, 5 moderate, 1 low) including `@sveltejs/kit` and `devalue` advisories. The previous version reported `0 vulnerabilities`.

  The audit now:
  - Falls through to `npm audit` not just when pnpm is missing, but whenever pnpm returns an error envelope, non-zero/non-one exit code, unparseable JSON, or output without `metadata.vulnerabilities`.
  - Skips with a clear `cannot run audit — pnpm: <reason>; npm: <reason>` summary when both tools fail.

  Tests cover the error-envelope, missing-metadata, and both-tools-failed paths.

## 0.1.2

### Patch Changes

- 2391f77: Recipe + audit robustness pass surfaced by a second-deep code review. No public API breakage; one inventory schema tightening flagged below.

  **Recipe fixes:**
  - `svelte-4-to-5` no longer adds packages the site never declared. The step now uses a new `bumpDep(..., { mode: "bump-only" })` option that updates existing entries but skips packages that aren't already present. Sites that intentionally exclude e.g. `@sveltejs/adapter-netlify` stay clean.
  - `svelte.config.js` migration handles multi-name imports (`{ vitePreprocess, sveltePreprocess }` — only `vitePreprocess` is removed, the rest are preserved) and `vitePreprocess(options)` calls with balanced-paren matching instead of an empty-parens regex.
  - `bump-deps` now runs `pnpm install` before `pnpm outdated --json` so the outdated probe acts on a fresh lockfile rather than potentially stale data.
  - `bump-deps` streams `pnpm up` output to the parent so long upgrades show live progress rather than looking hung.
  - `$$Props` interface removal now uses brace counting so nested-brace or multi-line interface bodies are removed correctly.

  **Audit fixes:**
  - A11y spec now sets `test.setTimeout(5 * 60_000)` so multi-route scans don't trip Playwright's 30s per-test default.
  - Lint audit hands relative paths to ESLint (cwd is already set), avoiding symlink dereferencing on pnpm workspaces.
  - Security audit handles npm `via: "string"` chains, deduplicates transitive vulnerabilities to their root advisory, and normalizes `"info"` severity to `"low"` instead of defaulting to `"moderate"`.

  **Robustness:**
  - CLI version readout no longer crashes on Yarn PnP setups (where `node_modules/<pkg>/package.json` isn't a real file). Falls back to `"unknown"`.
  - `cloneIfNeeded` rejects inventory `name` values that contain path separators, absolute paths, or `..` traversal segments — closes a path-escape vector for untrusted inventories.
  - `fromJsonFile` rejects inventory entries with relative `path` values; absolute paths only.

  **New options:**
  - `bumpDep(pkg, name, version, { mode: "bump-only" })` — added.
  - `SpawnFn` options gained `streaming?: boolean` to inherit stdio. When true, the returned stdout/stderr will be empty.

## 0.1.1

### Patch Changes

- 15d81b2: Fix lighthouse and a11y audits to parse real tool output. Previously they discarded everything the tools wrote and synthesized results from spawn exit code alone, which made `details.summary` always empty for lighthouse and silently dropped per-impact axe violation data.
  - Lighthouse now reads `<site>/.lighthouseci/manifest.json` for per-category scores and `<site>/.lighthouseci/assertion-results.json` for which assertions failed at what level.
  - A11y now writes a Playwright spec that aggregates axe violations across all configured routes into `<site>/.reddoor-a11y/results.json` (via the `REDDOOR_A11Y_OUTPUT` env var); the audit reads that artifact regardless of test outcome.
  - Security audit now surfaces per-advisory details (module, severity, title, CVEs) in `details.advisories` alongside the existing counts.
  - Stale `.lighthouseci/` and `.reddoor-a11y/` directories are removed before each run so a failed spawn can't masquerade as success by leaving last run's data in place.

## 0.1.0

### Minor Changes

- daf5ec4: Initial public release: configs, audits, recipes, inventory, CLI.
