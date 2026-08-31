---
"@reddoorla/maintenance": minor
---

feat(db): THE FLIP — Turso is authoritative (#612, #539 Phase 5 → 6)

`TURSO_IS_AUTHORITATIVE` is now `true`: every mirror runs strict (a Turso
failure is fatal, missing creds refuse to build, `missed` is a bug), and the
Airtable write is the swallowed best-effort shadow for the one-week rollback
window. The hourly `fleet-db-sync` workflow is retired in the same change —
the import and the inversion must move together, and do.

Go/no-go recorded immediately before the flip:
`FLEET_PARITY sites=44 health=44 schedule=44 reports=17 mismatches=0`.

Airtable is now a frozen archive: no hand-edits (the console replaces them),
no imports, no parity. Phase 6 (~a week out) deletes the shadow writes and
the Airtable client layer.
