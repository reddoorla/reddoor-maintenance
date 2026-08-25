---
"@reddoorla/maintenance": minor
---

Serve the audit report's data, so the report itself can become a page on reddoorla.com.

Two additions, both read-only and both in service of moving the prospect-facing
report off this app's domain and onto the marketing site, where it can be
rendered in Reddoor's own design language.

`GET /api/audit-report/:token` returns the stored `result_json` for a valid
token. It mirrors `prospect-report.mts` exactly on token handling — same
shape-check before the database, same 404 for anything else, same `private`
cache directive — and differs only in returning JSON rather than rendered HTML.
Like that route it is deliberately not operator-gated: the 128-bit token is the
credential. Keeping the two routes identical on token handling matters, because
a divergence there is a security difference rather than a stylistic one.

A new `./audit` package subpath exports `ProspectAuditResult` so a consuming
site can type the payload it fetches instead of hand-maintaining a copy of the
shape. The subpath is named for what a consumer receives; the source path keeps
this repo's own domain word, which is why `./audit` resolves to
`dist/prospect/types.js`.

That export is only safe because `src/prospect/types.ts` contains a single
`import type` and no runtime import — a runtime import there would pull the
Anthropic SDK and Playwright into a consuming site's bundle, which is exactly
what tsup's config comment warns about. Nothing enforced it before; a test does
now. The built entry is 33 bytes of JavaScript and 10.7 KB of types.

Turso credentials stay in this repo. The website only ever sees the JSON.
