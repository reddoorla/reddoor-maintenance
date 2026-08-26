---
"@reddoorla/maintenance": patch
---

Digest state moves to Turso, and the fleet homepage stops touching Airtable (#609).

Unlike the rest of #539 Phase 5 this is a migration, not a mirror — there was no
Turso table to dual-write into. New `digest_state` table (migration 0011), one
row holding the whole snapshot as JSON: both readers need the entire map, so a
keyed table would buy nothing on reads and its "give me every key" query would be
a raw scan needing a justified entry in the EXPLAIN gate's allowlist.

**The fleet homepage no longer touches Airtable at all.** Its digest NEW-badge
read was the last call, and it was an Airtable call on a request path — a Phase 2
leftover, since digest state was never in that phase's scope. The
`AIRTABLE_PAT`/`AIRTABLE_BASE_ID` gate that guarded the handler is gone with it,
so an Airtable outage can no longer degrade the page.

`runDigest` reads from Turso and writes to **both** stores, so the move stays
reversible while Phase 5 is in flight. It emits
`DIGEST_STATE_WRITE turso=<0|1> airtable=<0|1>` — one line, always, naming both
halves, because a dual-write that silently stopped running looked identical to a
healthy one for weeks in #585.

The snapshot read is deliberately **not** defensive: swallowing a failure would
badge every item NEW, which lands in the operator's inbox reading as "the whole
fleet degraded overnight". That makes Turso a hard requirement of the digest
step, which is now pinned by a workflow test.

`diffAttention` — the pure core — is untouched.

New `db backfill-digest-state` copies the existing Airtable row across, refusing
to overwrite a snapshot Turso already holds and reading back what it wrote.
