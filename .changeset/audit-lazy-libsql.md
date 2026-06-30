---
"@reddoorla/maintenance": patch
---

fix(audit): stop `reddoor-maint audit` eagerly importing the libSQL/Kysely stack

`src/db/client.ts` imported `@libsql/client`, `kysely`, and `@libsql/kysely-libsql` at the top level. Those live in `devDependencies` (consuming fleet sites never install them) and tsup externalizes them, so the `audit` CLI entry — which transitively reaches `db/client` via `fleet-events-writer` — eager-required packages the consumer lacks. The result: `reddoor-maint audit --only a11y` (the one command fleet CI runs) crashed on any site after it bumped to 0.64 with `Cannot find package '@libsql/client'`.

The libSQL/Kysely imports are now type-only at module scope and loaded with a dynamic `import()` inside `openDb()`, so the audit's static import graph stays dependency-free until a DB connection is actually opened. A new `smoke-dist` check loads `dist/cli/commands/audit.js` under the central-dep blocker to guard the regression (the existing `bin.js --version` check missed it because the command loads lazily).
