---
"@reddoorla/maintenance": patch
---

Lazy-load the libSQL/Kysely stack in `db/client` so the `audit` CLI command no longer eager-imports the central-only DB devDependencies. `reddoor-maint audit` (run in every fleet site's CI) crashed with `Cannot find package '@libsql/client'` because the `audit` entry transitively reached `db/client` (via `fleet-events-writer`), whose top-level `import` of `@libsql/client` / `kysely` / `@libsql/kysely-libsql` resolves to devDeps that consuming sites never install. Those values are now imported dynamically inside `openDb()`, keeping the module graph dependency-free until an actual DB connection is opened (the fleet-events writer already swallows the open failure best-effort). The dist smoke gate now also loads `cli/commands/audit.js` under the central-dep blocker — the `bin.js --version` check missed this because CLI subcommands load lazily.
