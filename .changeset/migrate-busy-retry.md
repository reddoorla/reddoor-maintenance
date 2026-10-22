---
"@reddoorla/maintenance": patch
---

`runMigrations` retries on `SQLITE_BUSY` (#1674). Separate OS processes opening one local `file:` database while a migration was pending refused each other's DDL with `SQLITE_BUSY: database is locked` (five of six threw); each statement in the runner now retries as the prospect-audit reservation already did. The retry (`isBusy`, `retryOnBusy`) moved from `src/db/prospect-audits.ts` to `src/db/busy.ts`, with no change to the reservation's behaviour; any error other than BUSY still throws on the first attempt.
