---
"@reddoorla/maintenance": patch
---

fix: legacy-reactive codemod skips comments + selfPackageVersion/resolvePackageVersion walk up to find our package.json

Two silent-corruption bug classes surfaced in tonight's deep review of the 0.7→0.10 arc. Both shipped in 0.10.x without ever triggering a test failure or a parser error.

**1. `legacy-reactive.ts` brace counter ignored comments.**

The codemod that converts `$: { ... }` Svelte 4 reactive blocks into `$effect(() => { ... })` walked the source counting braces, but only knew how to skip string literals — not `// line comments` or `/* block comments */`. A reactive block containing `// closing brace: }` would have the comment's `}` decrement the depth counter prematurely, causing `findMatchingClose` to return the wrong position. Result: either consume code AFTER the block (the real closing brace would be left as an orphan) or drop code FROM the block (truncated body emitted inside the new `$effect`). Output still compiles in Svelte 5 — no parser to scream — so the corruption shipped silently.

Fix: `findMatchingClose` now skips both `// …\n` and `/* … */` segments alongside the existing string-literal masking. 3 new regression tests in `tests/recipes/svelte-5/codemods/legacy-reactive.test.ts` pin both comment shapes plus an inflate-depth case.

**2. `selfPackageVersion` + `resolvePackageVersion` silently returned `"0.0.0"`/`"unknown"` when called from `dist/index.js`.**

Both helpers used a `here/../../package.json` shortcut that held for `src/X/Y.ts` (in dev) and `dist/cli/bin.js` (in CLI invocations) — both happen to be 2 dirs deep under the package root. But when a consumer imports `onboard` from `dist/index.js` (only 1 dir deep), the lookup walks above the package root, ENOENTs, and the defensive fallback kicks in. Library consumers got `^0.0.0` pinned into their site's `package.json` instead of `^0.10.3`. Same bug class as the bundled-assets ENOENT we hotfixed in 0.10.2.

Both functions now walk UP from the caller looking for the first `package.json` whose `name` matches `"@reddoorla/maintenance"`. Robust regardless of bundling layout.

`selfPackageVersion` and `selfCaretRange` are now exported from the library entry so the regression test can invoke them through the built `dist/index.js` — the production context where the bug actually shipped. New `tests/util/self-version.test.ts` covers both src-context and dist-context paths plus the walk-past-unrelated-package.jsons case (essential when the consumer's own `package.json` sits above `node_modules/@reddoorla/maintenance/`).
