---
"@reddoorla/maintenance": patch
---

`db sync` / `db import-airtable`: mirror Airtable deletions into Turso.

The importer was upsert-only, so a record deleted in Airtable stayed in Turso
forever. Parity flags that (correctly — a Turso row Airtable no longer has is a
real divergence), which meant one routine operator deletion wedged the hourly
`fleet-db-sync` red permanently, with no self-healing path and a retry that
re-read Airtable only to reach the same verdict.

The import now reaps rows whose Airtable record is gone, including a deleted
site's `site_health` and `site_schedule` rows (no foreign keys are declared, and
parity only reverse-checks `sites`, so those would otherwise linger unnoticed).

Reaping is the only destructive thing the importer does, so it refuses to act on
a read it cannot trust: never when Airtable returns zero rows while rows are
stored, and never more than `max(5, 10%)` of a table in one pass. A refusal
deletes nothing and leaves the run red — a wedged sync is recoverable, an
emptied Turso is not. Every removal is named and every refusal quoted on the new
always-emitted `FLEET_REAP sites=N reports=N refused=N` line.
