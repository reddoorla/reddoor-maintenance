---
"@reddoorla/maintenance": minor
---

Phase 1.5 of the Airtable → Turso migration (#539): nightly encrypted backups
with the restore rehearsed on every run — closing the no-backup gap open since
the 2026-08-02 architecture review.

`db dump` emits the whole database as plain SQL through the DATABASE-level
url+token the workflows already hold — `turso db dump` needs a browser-OAuth
platform login a workflow cannot do. Deterministic (stable table and row
order, so unchanged data dumps byte-identically), BLOB-safe (X'hex'), and
loadable by stock `sqlite3` — the engine a real disaster would replay it into.

`db verify-dump` is the rehearsal: load the dump into a fresh scratch engine
and compare restored row counts against the INSERT counts in the dump text
itself, emitting `DUMP_VERIFY … mismatches=N` on every run, clean included.
A dump that cannot restore is not a backup.

`fleet-db-backup.yml` runs both nightly, refuses a dump with no sites rows
(a broken dump path, not an empty fleet), refuses to upload plaintext when
BACKUP_PASSPHRASE is unset, gpg-encrypts, uploads with 30-day retention, and
files/auto-closes a tracking issue on failure — the fleet-smoke alarm plumbing.
The gate script is extracted from the YAML and executed under `bash -e` in
tests, clean case first.

Proven live before merge: a production dump (749 rows, 9 tables) verified
mismatch-free in the scratch engine AND restored into stock sqlite3 with all
44 sites, 337 submissions, and 13 reports intact.
