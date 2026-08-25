---
"@reddoorla/maintenance": patch
---

fix(airtable): make the attachment prune actually prune

`uploadAttachment`'s `replace` option never removed anything against the live API. Two
independent faults: the post-upload response keys `fields` by **field ID**, not field
name, so the lookup returned `undefined` and the empty list hit the `length <= 1` guard
and returned silently; and the prune PATCHed `/v0/{baseId}/{recordId}`, omitting the
table segment Airtable's update endpoint requires, which 403s.

`replace: true` is now `replaceIn: "<table>"` so the table cannot be omitted, an
unresolvable attachment list warns instead of returning quietly, and the PATCH path
shape is pinned by a test.
