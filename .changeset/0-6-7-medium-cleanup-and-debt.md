---
"@reddoorla/maintenance": patch
---

MEDIUM-severity hygiene fixes + small debt cleanup from the deep-review backlog. No behavior changes for happy paths — everything in this release is either a safety improvement, an internal extraction, or new test coverage.

### Fixed: `branchName` is now millisecond-precision (item #D)

Was second-precision. Two recipe invocations within the same second produced the same branch name and collided — rare for serial fleet runs, easy to hit when running from two terminals. ISO format now includes the millis fraction (`maint/recipe-20260526T120000123Z`); the collision window is one millisecond.

### Fixed: `removeDollarRestProps` no longer corrupts string literals (item #G)

`dollar-props-class` previously used a single `/g` regex for both the existence check (`.test()`) and the iterating replace (`.replace()`), with a manual `lastIndex = 0` reset to paper over the statefulness. The `.test()` path now uses a stateless non-`/g` regex; the `/g` variant is reserved for the actual iteration. Pure hygiene — no behavior change.

### Fixed: security audit no longer reports false-pass on `metadata.vulnerabilities = {}` (item #I)

A malformed audit output with `{ metadata: { vulnerabilities: {} } }` previously passed the existence check (`!{}` is `false`), counts defaulted to 0, and the audit silently reported "pass." Empty-object is now treated as a tool error and falls through to the other audit tool.

### New: `on:click|modifier` emits an `@migration-task` marker (item #E)

Svelte 5 removed event modifier syntax entirely. The rewrite is non-trivial (`on:click|preventDefault={fn}` → `onclick={(e) => { e.preventDefault(); fn(); }}`) so the codemod doesn't attempt it automatically — but it now inserts a `<!-- @migration-task: ... -->` comment immediately above each offending element. The original attribute is preserved verbatim. The codemod stays idempotent: re-runs against output don't double-insert.

### Internal: bin.ts `runOrExit` helper (debt #14)

The 7 command `.action()` bodies all duplicated the same try/catch + `process.exit(code)` pattern. Extracted to a `runOrExit(fn, opts)` helper; each `.action()` is now a one-liner.

### Internal: extracted shared utilities (debt #18)

- `siteLabel(site)` was inlined identically in 11 files (every audit + every recipe). Moved to `src/util/site.ts`.
- `findStringEnd(source, openIdx)` (formerly `findStringClose` / `findStringEnd` in two codemods) moved to `src/util/svelte-source.ts`.

### New: CLI tests for onboard, convert-to-pnpm, svelte-codemods (debt #16)

These three CLI commands previously had no dedicated test files — only the underlying recipe tests. Added `--help` + flag-validation smoke tests mirroring the existing bump-deps / sync-configs / upgrade pattern.
