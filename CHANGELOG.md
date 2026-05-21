# @reddoorla/maintenance

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
