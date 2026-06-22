---
"@reddoorla/maintenance": minor
---

Cut the dashboard handlers over to the libSQL store: form ingest writes submissions and
exact spam screen-out counters to libSQL (with an optional `DUAL_WRITE_AIRTABLE=1` soak
that also shadow-writes to Airtable for rollback insurance), submission triage reads/writes
libSQL, and the per-site page + cockpit read submissions and spam totals from libSQL.
Requires `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in the dashboard site env.
