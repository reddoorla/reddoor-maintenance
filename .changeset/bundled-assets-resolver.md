---
"@reddoorla/maintenance": patch
---

fix(reports): bundled-image loader walks up to find assets dir (regression in 0.10.0–0.10.1)

`reddoor-maint report --send-ready` on the published 0.10.0 and 0.10.1 packages crashed with `ENOENT: no such file or directory, open '<install>/dist/cli/check.png'` — tsup inlined the loader module into `dist/cli/bin.js` (and other entries), so its `dirname(fileURLToPath(import.meta.url))`-based sibling resolution looked next to `bin.js` instead of next to the actual `check.png` / `blurredTests.jpg` in `dist/reports/maintenance-email/assets/`. Dev tests didn't catch it because Vitest evaluates source files directly.

Fix: the loader now walks up from `import.meta.url` looking for the assets dir in either the dev layout (`src/reports/maintenance-email/assets/`) or the published layout (`dist/reports/maintenance-email/assets/`). Memoised — walks once per process. Source layout preferred so workspace dev always reads from the canonical source.

New regression test (`tests/reports/bundled-assets.test.ts`) builds dist and spawns Node to invoke `loadBundledImages` through `dist/index.js` from arbitrary cwds, including `/` — the actual failure mode that shipped (npx runs the package from `~/.npm/_npx/<hash>/` with the user's cwd elsewhere).

Also exports `loadBundledImages`, `CHECK_CID`, `BLURRED_CID`, and `BundledImage` from the library entry so consumers / tests can invoke the loader directly.
