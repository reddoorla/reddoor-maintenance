---
"@reddoorla/maintenance": minor
---

Phase 0 of the Airtable → Turso migration (#539): a lead whose site lookup fails
is dead-lettered, not lost.

`ingestSubmission` awaited `getWebsiteBySlug` — an Airtable read — before
anything was persisted, so a thrown lookup 502'd the visitor with the lead
recorded nowhere. The 2026-08-17 quota outage did exactly that, while the
submissions store (Turso) was healthy the whole time; it is why that outage's
lead loss was unmeasurable after the fact.

With the new `deadLetter` dep wired (the production handler wires it to the new
`submission_deadletter` table, migration 0006), a thrown lookup now writes the
raw payload, slug, error, and the Turnstile verification computed at receipt —
tokens expire in 300s, so replay reuses that answer — and the visitor gets an
honest "accepted". `reddoor-maint db replay-deadletters` then runs each captured
lead back through the normal ingest pipeline once the lookup recovers: real spam
classification, notify, and fan-out, oldest first. Replay outcomes that the
store actually answered (accepted, rejected, unknown-site) are terminal; a
lookup that throws again leaves the row for the next run — and the replay
strips any smuggled `deadLetter` dep so a retry can never mint a duplicate. A
stored `fail` verdict still escalates on a `requireTurnstile` site: replay does
not launder spam.

Three boundaries hold: a lookup that _resolves_ null is still `unknown-site`
(the store answered); a testMode probe still throws (the form-e2e audit must red
when central ingest is degraded, and a probe persists nothing worth saving); and
a failing dead-letter write propagates (both stores down — the 502 is honest).
Callers that never wired `deadLetter` are byte-for-byte unchanged.
