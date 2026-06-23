---
"@reddoorla/maintenance": minor
---

Stop fleet sites from inheriting the server/report/audit dependency chain (and its transitive CVEs).

The package shipped `mjml`, `resend`, `airtable`, `@google-analytics/data`, `google-auth-library`, the libSQL/Kysely stack, `sharp`, `svix`, and `@lhci/cli` as `dependencies`, so every consuming site installed them transitively — even though sites only import `./forms` + `./configs/*` and run `reddoor-maint audit --only a11y` in CI. That dragged in transitive vulnerabilities (`html-minifier` via `mjml`, `tmp` via `@lhci/cli`, …) fleet-wide.

Those 11 packages are now `devDependencies` (this repo's CLI, Netlify functions, and audit pipeline still use them). To keep the CLI working for consumers without them:

- The CLI (`bin.ts`) now lazy-loads each command (`await import("./commands/…")` inside the action) instead of eagerly importing every command at startup.
- `tsup` builds with `splitting: true` and externalizes all node_modules deps, so each command becomes an on-demand chunk and `bin.js`'s startup graph stays free of the heavy chain.
- A `smoke-dist` gate asserts every consumer-facing entry (`bin.js`, `./forms`, `./configs/*`) has a static import closure free of the central-only deps.

Verified by a tarball-install simulation: a fresh consumer no longer has `mjml`/`airtable`/`@lhci/cli`/`html-minifier`/etc. in `node_modules`, while `./forms`, `./configs/*`, and the CLI still load and run. The kitchen-sink `.` entry (reports/audits/dashboard) is now intended for in-repo use only; fleet sites never import it.
