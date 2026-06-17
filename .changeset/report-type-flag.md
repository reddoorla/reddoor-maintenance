---
"@reddoorla/maintenance": minor
---

`report <slug>` gains a `--type <Maintenance|Testing>` flag so the operator can
draft a Testing report (not just the default Maintenance) for a single site on
demand. Type parsing is case-insensitive and validated before any Airtable access,
so a bad value fails fast without credentials; Launch and Announcement are
rejected with a pointer to their own commands (`launch` / `announce`). Works with
`--preview` too.
