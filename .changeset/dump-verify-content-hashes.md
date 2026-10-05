---
"@reddoorla/maintenance": patch
---

`db verify-dump` now checks contents, not only counts. A dump's manifest carries a sha256 per table over every cell of its rows, taken from the values the driver read. The rehearsal hashes the restored tables the same way and reports `✗ <table>: content hash origin=… restored=…` on any difference. `DUMP_VERIFY` gains `hashed=N`. Before this, a header image with one byte flipped verified clean, because only row counts and the summed blob length were compared. A dump whose manifest has no hashes now fails the rehearsal and is no longer passed unchecked. `db restore` is unchanged.
