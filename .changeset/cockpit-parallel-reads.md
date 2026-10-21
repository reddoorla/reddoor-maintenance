---
"@reddoorla/maintenance": patch
---

The cockpit's page loads read Turso in parallel waves: `/` in one round trip and `/s/:slug` in two, where both made nine one after another. `openDb` takes `{ concurrentReads: true }`, which lifts Kysely's per-query lock (the libSQL dialect reports SQLite's single-connection adapter); only the cockpit's page reads ask for it.
