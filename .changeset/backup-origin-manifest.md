---
"@reddoorla/maintenance": patch
---

The backup now verifies against the origin, not against itself (2026-08-26 review).

The restore rehearsal parsed its expected row counts **out of the dump text**, and
got its actual counts from **loading that same text**. Both sides derived from one
artifact, so a dump that collected 5 of 44 sites shrank both numbers together and
verified clean. With the freeze making Turso the only store, that dump is the
entire rollback story.

Every dump now carries an **origin manifest** on its first line — per-table row
counts and total `header_image` bytes, read from the live database before any row
is serialised. `verify-dump` compares against that. A dump with no manifest is
refused rather than falling back to self-comparison, which would silently
re-enable the blind spot on the one artifact nobody watches.

**Table coverage is asserted.** `tables=N` was printed and never checked, so a
table a migration failed to create rode green forever — `digest_state` and
`prospect_audits` were in no artifact at all the night this was found. A runtime
`DATABASE_TABLES` list, with a compile-time check that names any table missing
from it, is now compared against what restored.

**The encrypted artifact is verified.** Everything used to check `dump.sql`,
which is then deleted — nothing ever decrypted the `.gpg` that actually gets
uploaded, so a corrupt encryption would have shipped green. The workflow now
decrypts it back and re-runs the same gate on the round-tripped copy.

**New `db restore --url <target> --file <dump>`.** The nightly rehearsal loads
into `:memory:`, which proves the SQL parses — not that you can get the data back
into a real libSQL target, the operation an actual recovery needs and one that
had never been performed. It refuses a non-empty target and a manifest-less dump,
and verifies the restored result against the origin manifest.

**NUL bytes round-trip instead of being silently stripped.** The old justification
was that they cannot appear in this schema's TEXT columns — but `submissions`
free text is attacker-supplied and SQLite stores NUL happily, so the backup would
have quietly differed from the origin with no signal.

`countInsertsInDump` is removed. Its line-anchored regex was also inflatable by a
submitted message containing a line starting `INSERT INTO sites `, which would
have redded the backup; the manifest removes that class entirely.
