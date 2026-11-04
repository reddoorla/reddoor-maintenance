# 2026-11-04 — The vite override takes package.json's pin

Landed in: `fix/vite-override-tracks-pin` (this PR).

#1894 (Renovate, all non-major) has been red on `ERR_PNPM_OUTDATED_LOCKFILE` since 11-02: "The importer resolution is broken at dependency "vite": version "8.3.5" doesn't satisfy range "8.2.4"". The cause is in `pnpm-workspace.yaml`, not in #1894. The override pinned `vite: "8.2.4"` while `package.json` has said `"vite": "8.3.5"` since #1721 (10-26). An override outranks a devDependency, so **`main` has resolved vite 8.2.4 since 10-26, and the `package.json` pin did nothing.** `main` stayed green because its lockfile agreed with the override. #1894's lockfile did not.

Why it drifted: the shared preset (`reddoorla/.github` `renovate-config.json`) sets `enabled: false` for `pnpm-workspace.overrides`, so Renovate bumps `package.json` and never the override. The comment above the pin said "Renovate maintains the exact pin going forward", which was true for the security PR #1586 (it moved both) and false for every group bump after it.

**Belief corrected on contact:** the first guess (11-03) was that #1894's lockfile was built against an older `main`. It was not: Renovate's 7:30pm PT 11-03 rebuild came out the same, because `main` already pinned 8.3.5 and the override was the thing that disagreed. A rebase cannot fix this.

The fix: `vite: "$vite"`, which takes the exact pin from `package.json`, as `google-auth-library: "$google-auth-library"` already did in the same block. The lockfile now resolves vite 8.3.5 everywhere, above the 8.2.4 security floor. Pairing proof (11-03, on this branch): a `package.json`-only change to `8.3.4` plus `pnpm install --lockfile-only` moved both the override and the importer, and the frozen install passed.

Guard: `tests/build/overrides-track-package-json.test.ts` fails on any literal override of a package the repo also depends on directly. Selector keys (`tmp@<0.2.6`) are left alone. Mutations, re-run on `98d5b522` today: the override back to `"8.2.4"`, red; `google-auth-library: "^10.6.2"`, red; dropping the `direct.has(key)` filter, red. The unmutated file is 2 of 2 green.

`pnpm verify` ran green on 11-03 with this exact lockfile (699 files, 12551 tests passed, 8 skipped), using the `vite: "8.3.5"` variant, whose lockfile is byte-identical (`cmp`) to the `$vite` one. Since then `main` has moved only by the release #1918, and the patch applied without conflict.

Usage: recorded in the session's closing entry.
