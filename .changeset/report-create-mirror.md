---
"@reddoorla/maintenance": patch
---

Report rows now dual-write into Turso at CREATE time (#539 Phase 5).

Every report mirror built so far is an UPDATE, which does nothing at all for a
row that does not exist yet — so a draft created at 09:05 was invisible to the
Turso-backed console until the 09:20 sync. Phase 4 moved report review onto
Turso, which makes that window visible to the operator today; at the freeze it
stops being a window and becomes a lost row.

`mirrorReportInsert` maps the record with the IMPORTER's own `mapReportRecord`,
which is also what parity diffs against — so the mirrored row is parity-clean by
construction rather than by a column list someone has to remember to extend. Its
test asserts exactly that equivalence: mirror one record, import the same record,
demand identical rows.

Wired through `createDraft`'s new optional mirror at all three creators (the
nightly `--due` batch, `announce`, `launch`), each at its composition root rather
than defaulted inside the recipe — a default would open a real libSQL handle from
inside the unit suite, and on a machine with `TURSO_*` exported that means tests
writing into production.

Unlike the Phase 3 mirrors this one never returns null. #585 is why: that helper
returned null without creds and the dual-write silently no-opped for weeks,
because a dead mirror and a healthy one produced identical output. Here
creds-absent is a state the mirror reports, so every draft emits one
`DRAFT_MIRROR` line and an absent line means the wiring is gone.
