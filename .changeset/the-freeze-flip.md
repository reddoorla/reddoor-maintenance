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

The pre-merge deep review closed three regressions the flip would have
exposed: the send batch now mirrors its own `Sent at` / `Resend message ID`
stamp into Turso (the retired hourly sync was the only thing converging
those, and an unmirrored stamp disarms the console's already-sent guards);
`fleet-prismic-drift` and `fleet-security`'s renovate-dispatch steps get the
Turso creds their now-strict mirrors refuse to build without; and
`db import-airtable` / `db sync` refuse under the freeze unless `--force`,
because a habitual import would overwrite authoritative rows from the frozen
archive. A failed Launch flip or sent-stamp mirror now reds the send run
instead of hiding in a green one.
