# @reddoorla/maintenance

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
