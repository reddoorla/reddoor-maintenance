---
"@reddoorla/maintenance": patch
---

The cockpit's snapshot stays fresh: every change a page makes reads it again in place, and an open, visible cockpit asks the store's change counter (`/api/cockpit/version`, migration `0048_cockpit_version`, kept by triggers on every table the snapshot reads) on focus and once a minute, reading the snapshot again only when it moved. A signed-out session loads the page in full, which sends it to sign-in. `db dump` now writes indexes and triggers after the rows, as `sqlite3 .dump` does, so a trigger cannot fire on a restore's replayed inserts.
