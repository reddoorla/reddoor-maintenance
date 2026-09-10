---
"@reddoorla/maintenance": patch
---

The shared eslint config ignores the match-harness Phase 0 reference capture.

`matching/capture-reference.mjs` downloads the reference site's own HTML, CSS
and JavaScript byte-for-byte into `matching/spec/`. On 29 Navy's first capture
that handed eslint Webflow's two bundles and jQuery 3.5.1, and `pnpm verify`
went red with 745 errors — 377, 78 and 290 — `'define' is not defined` and
`no-unused-expressions` several hundred times over.

The ignores array already named this class in its own comment: artifacts that
are git-ignored in every repo but present on disk locally. `docs/superpowers/`
and `scratchpad/` were the first two members; `matching/spec/` is the third,
and `scratch-diff*/` from the same generated .gitignore block is included with
it rather than waiting for its own red.

`prettier --check .` never saw these files, which is why the failure looked
like an eslint quirk rather than a missing ignore: prettier 3 defaults
`--ignore-path` to `.gitignore`, and the recipe's block carries `matching/*`.
Eslint flat config reads no ignore file at all. `.prettierignore` does not
list the capture either — with `--ignore-path .prettierignore` prettier flags
five files under `matching/spec/`.

Scoped to `matching/spec/` and not `matching/`, which is the distinction that
matters. beachfront-dentistry ignores `matching/` wholesale and un-linted its
own probe scripts doing so; measured on 29 Navy, an unused const appended to
`matching/probe-inventory.mjs` still errors while `matching/spec/` is silent.
The trailing slash is load-bearing in the other direction too — `matching/spec*`
also swallows the tracked `matching/spec-sections/`.

This does not reach a site until the release lands and the site bumps its
dependency, so 29 Navy's local `eslint.config.js` workaround has to stay until
then. Note that `sync-configs` treats `eslint.config.js` as an exact-match
template, so a routine sync in that window would delete the workaround and
re-arm the failure.
