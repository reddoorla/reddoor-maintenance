---
"@reddoorla/maintenance": patch
---

`db dump` no longer emits a backup whose origin manifest disagrees with its own INSERTs. Row
counts are re-read after serialising; if anything moved, the dump is discarded and re-taken (up
to three times) rather than shipped, which is what turned one form submission landing during the
nightly window into a red `verify-dump` and no uploaded backup at all.
