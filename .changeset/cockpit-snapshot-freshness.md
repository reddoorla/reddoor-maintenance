---
"@reddoorla/maintenance": patch
---

The cockpit says when its snapshot is out of date. An open, visible cockpit asks the store's change counter (`/api/cockpit/version`, migration `0048_cockpit_version`, kept by triggers on every table the snapshot reads) on focus, on returning to the tab and once a minute. When the counter has moved, a notice offers a reload, and the next navigation is a full load. The page never changes under the operator. A check that finds the session ended marks the next navigation as a full load, which goes to sign-in. `db dump` now writes indexes and triggers after the rows, as `sqlite3 .dump` does, so a trigger cannot fire on a restore's replayed inserts.
