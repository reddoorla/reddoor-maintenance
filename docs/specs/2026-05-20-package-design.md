# `@reddoorla/maintenance` Package — Design

**Status:** approved (brainstorm)
**Author:** Tucker Lemos
**Date:** 2026-05-20

## Summary

A new public npm package, `@reddoorla/maintenance`, that owns the canonical maintenance methods used across all reddoor-built sites. It exposes both a library API and a `reddoor-maint` CLI. The starter and existing client sites depend on it. A separate (future) ops repo wires in an Airtable site inventory and orchestrates fleet-wide runs.

## Motivation

The reddoor starter accumulates real maintenance content — the Svelte 4→5 upgrade recipe, Lighthouse config, Playwright a11y tests, ESLint/Prettier rules, security/accessibility docs. Today these live only in the starter, which is a template repo: new sites inherit them at clone time but immediately drift. There is no mechanism to push improvements back into existing client sites or to audit fleet-wide.

This package extracts those methods into a single source of truth that the starter imports and the ops repo can apply across the fleet.

## Goals

- Single source of truth for maintenance configs (lighthouse, eslint, prettier, playwright a11y).
- Deterministic, idempotent recipes for upgrades and sync.
- Read-only audits that produce structured results.
- A small library surface the ops repo can compose, plus a CLI for ad-hoc use.
- Zero coupling to Airtable — inventory is pluggable.

## Non-goals (v1)

- Fleet orchestration UI, dashboards, or persistence.
- Pushing branches or opening PRs (the ops repo does that).
- LLM-driven recipe execution.
- Third-party plugin/registry surface.
- Migration of any non-reddoor site stacks.

## Architecture

**Approach:** Functional core + thin CLI.

- Library is a set of plain functions taking a `Site` object and returning typed results.
- CLI is a thin `cac`/`commander` wrapper that calls the library functions and formats output.
- Configs are exported as plain values via subpath exports.
- Inventory is a `() => Promise<Site[]>` interface with two built-in providers; the Airtable adapter lives in the ops repo, not here.

### Repo layout

New repo `tucksravin/reddoor-maintenance`, published as `@reddoorla/maintenance`.

```text
reddoor-maintenance/
├── src/
│   ├── index.ts                 # public API barrel
│   ├── types.ts                 # Site, AuditResult, RecipeResult, InventoryProvider
│   ├── audits/
│   │   ├── deps.ts
│   │   ├── lighthouse.ts
│   │   ├── a11y.ts
│   │   ├── security.ts
│   │   └── lint.ts
│   ├── recipes/
│   │   ├── sync-configs.ts
│   │   ├── bump-deps.ts
│   │   └── svelte-4-to-5.ts
│   ├── inventory/
│   │   ├── local.ts
│   │   └── json.ts
│   ├── configs/
│   │   ├── lighthouse.ts
│   │   ├── eslint.ts
│   │   ├── prettier.ts
│   │   └── playwright-a11y.ts
│   ├── cli/
│   │   ├── bin.ts
│   │   └── commands/
│   └── util/
│       ├── git.ts
│       └── pkg.ts
├── tests/
├── fixtures/
│   ├── pristine-starter/
│   ├── pre-svelte5/
│   └── drifted-configs/
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

**Build:** `tsup` produces ESM + `.d.ts`. `package.json` `exports` map enables both root and subpath imports (`@reddoorla/maintenance/configs/lighthouse`). `bin` field exposes `reddoor-maint`.

**Engines:** Node `>=20`. pnpm-compatible; no enforced `packageManager` (consumer sites may use npm).

## Public API

```ts
export type Site = {
  path: string; // absolute path to a checked-out site
  name?: string; // from inventory provider or inferred
  repoUrl?: string; // optional, used for cloning
  meta?: Record<string, unknown>; // free-form provider metadata
};

export type AuditResult = {
  audit: string;
  site: string; // site.name ?? site.path
  status: "pass" | "warn" | "fail" | "skip";
  summary: string;
  details?: unknown;
};

export type RecipeResult = {
  recipe: string;
  site: string;
  status: "applied" | "noop" | "failed";
  commits: string[]; // SHAs created (empty if noop)
  notes?: string;
};

export type InventoryProvider = () => Promise<Site[]>;

// audits (read-only)
export function runAudits(site: Site, which?: AuditName[]): Promise<AuditResult[]>;
export function runAuditsAcross(sites: Site[], which?: AuditName[]): Promise<AuditResult[]>;

// recipes (writes; each opens a branch + commits)
export function syncConfigs(site: Site, opts?: { which?: ConfigName[] }): Promise<RecipeResult>;
export function bumpDeps(
  site: Site,
  opts?: { group?: "patch" | "minor" | "major" },
): Promise<RecipeResult>;
export function upgradeSvelte4to5(site: Site): Promise<RecipeResult>;

// inventory built-ins
export function localPath(path: string): InventoryProvider;
export function fromJsonFile(path: string): InventoryProvider;
```

### Configs (subpath imports)

```ts
import lighthouse from "@reddoorla/maintenance/configs/lighthouse";
import eslint from "@reddoorla/maintenance/configs/eslint";
import prettier from "@reddoorla/maintenance/configs/prettier";
import a11y from "@reddoorla/maintenance/configs/playwright-a11y";
```

### Invariants

- All recipes are idempotent: a second run on an already-applied site returns `status: 'noop'` with `commits: []`.
- All recipes work on a fresh branch named `maint/<recipe>-<UTC-timestamp>`; they never modify `main`.
- Audits never write to the working tree.
- `Site.meta` is opaque to the package; providers and the ops repo are the only readers.

## CLI

```text
reddoor-maint <command> [options]

Commands:
  audit [site]                  Run all audits against a site (default: cwd)
    --only deps,lighthouse      Run a subset
    --json                      Machine-readable output
    --fleet <inventory>         Run across all sites from inventory

  sync-configs [site]           Sync canonical configs into a site
    --only lighthouse,eslint    Pick which configs
    --dry                       Show diff, don't write
    --fleet <inventory>

  bump-deps [site]              Bump dependencies
    --group patch|minor|major   Default: minor
    --fleet <inventory>

  upgrade svelte-4-to-5 [site]  Run the 7-commit Svelte 4→5 upgrade
    --dry
    --fleet <inventory>

  list-recipes                  Print available recipes + descriptions
  list-audits                   Print available audits + descriptions

Global flags:
  --cwd <path>                  Override working dir (default: process.cwd())
  --workdir <path>              Clone target for fleet mode (default ~/.reddoor-maint/sites)
  --verbose
  --no-color
```

### Behavior

- `[site]` is a path; omitted → cwd.
- `--fleet <inventory>` accepts either:
  - A JSON file (read by `fromJsonFile` provider), or
  - A JS file path that `default-export`s an `InventoryProvider` (the escape hatch for the ops repo's Airtable adapter).
- Fleet mode: if `site.path` is not a working checkout and `site.repoUrl` is set, clone to `<workdir>/<name>`; otherwise operate in place.
- Writes happen on a fresh branch; the CLI prints `branch name + commit SHAs` at the end. It does not push or open PRs.
- Exit codes: `0` all passed/applied, `1` any failures, `2` usage errors.

## What ships in v1

### Audits

| Name         | Description                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deps`       | Diffs site `package.json` against a baseline version map bundled in the package (`configs/baseline-versions.ts`, refreshed at each package release from the starter's current `package.json`); reports drift by semver bucket. No network. |
| `lighthouse` | `@lhci/cli autorun` against `npm run build && npm run preview` using the canonical lighthouserc. Reports perf/a11y/best-practices/SEO scores.                                                                                              |
| `a11y`       | Playwright + `@axe-core/playwright` against the routes list exported from `configs/playwright-a11y.ts`; reports violations grouped by impact.                                                                                              |
| `security`   | `pnpm audit --json` (falls back to `npm audit`); filters dev-only unless `--include-dev`.                                                                                                                                                  |
| `lint`       | ESLint + Prettier using the canonical configs.                                                                                                                                                                                             |

### Recipes

| Name                    | Description                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-configs`          | Overwrites a known set of files (`eslint.config.js`, prettier config, `lighthouserc.json`, `playwright.config.ts`, `tests/a11y/*`) with templates that re-export from `@reddoorla/maintenance/configs/*`. One commit per file group.                                                                                   |
| `bump-deps`             | `pnpm up --latest` (scoped by `--group`); commits the lockfile change. Noop if nothing to bump.                                                                                                                                                                                                                        |
| `upgrade svelte-4-to-5` | 7-commit recipe encoded as TS: (1) bump svelte/kit/vite/vite-plugin-svelte, (2) migrate `svelte.config.js`, (3) codemod runes (use `svelte-migrate` where it works, ast-grep for the rest), (4) Tailwind 3→4, (5) replace deprecated APIs (the top-12 gotchas), (6) run tests + fix imports, (7) final summary commit. |

### Inventory providers

| Name                 | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `localPath(path)`    | Wraps a single local checkout as a `Site[]` of length 1. |
| `fromJsonFile(path)` | Reads `[{ name, path, repoUrl, meta }]` from JSON.       |

## Testing strategy

- `tests/fixtures/` holds three minimal real SvelteKit projects: `pristine-starter/`, `pre-svelte5/`, `drifted-configs/`.
- Audits: vitest snapshot tests run each audit against each fixture; assert on result shape and status.
- Recipes: vitest tests copy a fixture to a tempdir, run the recipe, assert that (a) the right branch exists, (b) the diff matches expectations, (c) a second run is `noop`.
- No network in unit tests. Lighthouse + security audits use injected fakes; real-tool integration tests are tagged and CI-only.
- CLI smoke test: spawn `node dist/cli/bin.js audit ./fixtures/pristine-starter --json` and validate the JSON shape.

## Release / versioning

- Semver. `0.x` while shaping the surface; cut `1.0` once the starter + at least one client site are on it.
- Changesets for release notes + version bumps.
- GitHub Actions: PR → lint+test; push to `main` with a changeset → publish to npm.

## Starter integration (consumer side)

After the package's first publish, the reddoor-starter is updated to:

- Add `"@reddoorla/maintenance": "^0.x"` as a dependency.
- Replace `eslint.config.js`, `lighthouserc.json`, prettier config, and the a11y Playwright setup with one-line re-exports from the package.
- Link to the package from `docs/migration.md`, `docs/accessibility.md`, `docs/security.md`, and `docs/upgrading-from-svelte-4.md` as the canonical reference.

The svelte4-to-5-upgrade skill remains useful as the documentation/intent that informed `recipes/svelte-4-to-5.ts`; the package supersedes it as the executable form.

## Open questions

None blocking. Future considerations (out of v1 scope):

- Whether to add a plugin/registry surface once the recipe count justifies it.
- Whether to add a managed Airtable adapter as an optional `@reddoorla/maintenance-airtable` companion package once the ops repo's adapter stabilizes.
- Whether `sync-configs` should support a "lockfile" mechanism so sites can opt out of specific config groups.
