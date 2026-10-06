---
"@reddoorla/maintenance": patch
---

`db verify-dump` now checks contents, not only counts. A dump's manifest carries a sha256 per table over every cell of its rows, taken from the values the driver read. The rehearsal hashes the restored tables the same way and reports `✗ <table>: content hash origin=… restored=…` on any difference. `DUMP_VERIFY` gains `hashed=N`. Before this, a header image with one byte flipped verified clean, because only row counts and the summed blob length were compared. A dump whose manifest has no hashes now fails the rehearsal and is no longer passed unchecked. `db restore` is unchanged.

`db dump` now writes every number that is not a safe integer in exponent form with 17 significant digits. SQLite's text-to-double parse misreads about one shortest-form value in ten thousand by one ULP (0.3118957494450251 came back as 0.31189574944502513). Past 2^53, JS's shortest form is not the double's digits at all (`String(2 ** 60)` is `1152921504606847000`), so a whole-number REAL in an untyped column came back as a different INTEGER. Either way the restored copy differed from the origin.
