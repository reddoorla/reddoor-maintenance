---
"@reddoorla/maintenance": patch
---

A report send now stamps Turso's `sent_at` before the Airtable shadow, and a Launch flips Turso before Airtable. Turso's stamp is what takes a report out of the send queue. When the Airtable write came first, a failed or stuck shadow write left a sent report queued, one 24 h idempotency window away from going out a second time (#928). The Airtable half can still red the run, but it can no longer make a sent email replay.
