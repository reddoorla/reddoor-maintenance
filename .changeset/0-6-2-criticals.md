---
"@reddoorla/maintenance": patch
---

Five critical fixes surfaced by an overnight deep review of the codebase after yesterday's `0.3.0 → 0.6.1` arc.

### Restored: `legacyReactiveToRunes` codemod

The Svelte 4 `$:` reactive statement codemod was authored yesterday but never made it into the merged PR #20 — the merge fired against an earlier tip of the branch and the follow-up commit was lost. Fleet sites were patched via local `dist`, but `npm install @reddoorla/maintenance@0.6.1` did not include it. Restored from the orphan branch and registered in the codemod pipeline.

### Fixed: registration drift on the recipe registry

`"svelte-codemods"` was in the `RecipeName` type union but missing from `ALL_RECIPE_NAMES` and the package's main entry. `isRecipeName("svelte-codemods")` silently returned `false`; library consumers couldn't `import { svelteCodemods }` at all. Now exported and registered. Added a type-test that the runtime array exactly matches the union.

### Fixed: `DEFAULT_PACKAGE_VERSION` was hardcoded at `^0.2.0`

Three majors stale. Any fresh `onboard` was pinning new sites to a version of the maintenance package that predates `convert-to-pnpm`, `svelte-codemods`, and every codemod we shipped. The default now derives from this package's own `package.json` at runtime via the new `selfCaretRange(import.meta.url)` helper — no manual syncing at each minor bump.

### Fixed: `git clone` argv-injection on inventory `repoUrl`

[src/cli/fleet/clone-if-needed.ts] previously passed `repoUrl` to `git clone` positionally, so a `repoUrl` starting with `-` was interpreted by git as a flag (CVE-2017-1000117 family — `--upload-pack=evil` is a known RCE primitive). Now validates the URL against a scheme allowlist (`https://`, `http://`, `ssh://`, `git://`, `file://`, or scp-style `user@host:path`) and passes `--` to `git clone` as a defense-in-depth separator.

### Bundled tests

- New regression test in `types.test.ts` that the recipe registry doesn't drift again.
- New `onboard.test.ts` case that pins use the live package version.
- 5 new tests in `clone-if-needed.test.ts` covering argv-injection rejection, scheme validation, and the `--` separator.
