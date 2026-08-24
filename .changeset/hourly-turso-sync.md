---
"@reddoorla/maintenance": minor
---

feat(db): hourly Airtable → Turso sync — the Phase 2 backbone (#539)

New `db sync` action: one pass = import (attachment fetches only where the
stored report row lacks a body) + the parity check, with one internal retry to
absorb a write landing between the import's read and the parity check's read.
Emits `FLEET_SYNC … mismatches=0` on every clean run; exits 1 on persistent
mismatch. The new `fleet-db-sync` workflow runs it hourly at :20 with the
fleet-smoke-style tracking-issue alarm, keeping Turso fresh while Phase 2
readers move over and writers still write Airtable.
