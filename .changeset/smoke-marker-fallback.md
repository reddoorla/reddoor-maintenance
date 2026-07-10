---
"@reddoorla/maintenance": patch
---

smoke-suite recipe: detect the hydration marker instead of hardcoding `footer`. Bespoke sites whose Svelte source renders no literal `<footer>` element (a capital-F `<Footer />` component tag doesn't count) now get a `main` — or, failing that, `body` — marker in the generated `tests/smoke/routes.ts`, with a recipe note flagging the missing landmark. Starter-shaped sites still receive the byte-verbatim template. Prevents the false-fail that red'd la-homelessness-initiative on the first nightly fleet-smoke run.
