---
"@reddoorla/maintenance": patch
---

Six recipe + CLI hygiene fixes from the deep-review backlog.

### Fixed: `writePackageJson` preserves source indent style (item #5)

The helper hardcoded `JSON.stringify(pkg, null, 2)`, so any site using tabs or 4-space indent got reformatted on every recipe that touched `package.json` — noisy and irrelevant diffs in `convert-to-pnpm`, `onboard`, and the svelte-5 bump-versions step. The helper now sniffs the existing file's indent (tab vs N-space) and round-trips with the same style. New files default to two spaces, matching prior behavior.

### Fixed: `onboard` sources `AUDIT_DEPS` from `baseline-versions` (item #10)

`AUDIT_DEPS` previously hardcoded `@lhci/cli`, `@playwright/test`, and `@axe-core/playwright` versions inline — the same staleness foot-gun that `DEFAULT_PACKAGE_VERSION` had before 0.6.2. The map now resolves each name from `src/configs/baseline-versions.ts` at module load, throwing immediately if any audit dep is missing from the baseline (programming-error check). A regression test guards against re-introduction of hardcoded literals.

### Fixed: `bump-deps` checks the working tree clean before running `pnpm install` (item #6)

The pre-flight `pnpm install` (needed so `pnpm outdated` sees a fresh lockfile) ran _before_ the clean-tree check, so a desynced lockfile would be silently rewritten on top of whatever else was in the user's tree. The check is now first; `pnpm install` only runs once we know the tree is clean.

### New: `bump-deps` detects competing lockfiles and refuses to run (item #7)

If `package-lock.json` or `yarn.lock` exists without a `pnpm-lock.yaml`, the recipe is now a fast `{ status: "failed", notes: "run convert-to-pnpm first" }` instead of emitting opaque pnpm errors. No pnpm commands are attempted in this case.

### Fixed: `sync-configs --only` rejects unknown config names (item #8)

The CLI's `parseOnly` previously did `as ConfigName[]` and silently passed typos through, producing a confusing "noop" result. It now validates every name against `ALL_CONFIG_NAMES` (newly exported from `recipes/sync-configs.ts` alongside an `isConfigName` type guard, mirroring `ALL_AUDIT_NAMES`) and throws `{ exitCode: 2 }` with the offending name and the valid list. A type-test in `tests/types.test.ts` guards against drift between the runtime array and the `ConfigName` union.

### Fixed: `sync-configs --dry` reports gitignore drift (item #9)

`dryPlan` previously iterated only the five template configs, so a missing or stale `.gitignore` was silently absent from the dry output even though a real run would create or merge one. The dry plan now also calls into the gitignore canonical-entries merge and reports `would create .gitignore` or `would update .gitignore (N canonical entries to add)` as appropriate. Respects `--only gitignore` to scope output.
