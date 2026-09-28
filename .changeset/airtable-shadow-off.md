---
"@reddoorla/maintenance": minor
---

The Airtable shadow is off: nothing writes to Airtable any more

`AIRTABLE_SHADOW_WRITES` in `src/db/freeze.ts` ships `false`. Every Airtable
shadow writer now skips `rec…` ids too, logging
`AIRTABLE_SHADOW skipped=shadow-off writer=<name> id=<id>`. The FieldSet writers
still return their payload for the Turso write. That covers every `update*`
Websites writer, the report writers, `uploadAttachment`, `ensure-site`'s shadow,
and the digest's Airtable snapshot, which now reports
`DIGEST_STATE_WRITE … airtable=off`.

Turso has been the only authoritative store since 2026-08-31. The Airtable base
stays readable as a frozen archive. Flipping the constant back to `true` restores
the shadow, and every shadow-on behaviour stays pinned by tests. Deleting the
Airtable layer (#646 steps 6–8) is separate and not part of this change.
