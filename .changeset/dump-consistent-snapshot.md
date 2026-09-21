---
"@reddoorla/maintenance": patch
---

`db dump` no longer emits a backup whose origin manifest disagrees with its own INSERTs. The
manifest is still measured on the live database before a single row is serialised, and it is now
compared against what the dump actually wrote — the rows serialised per table and the
header-image bytes serialised — rather than against a second live count taken afterwards. That
distinction is the fix rather than a detail: a second live count throws away a perfectly
consistent dump when a row lands after its table was read, misses a row inserted before the read
and deleted after it, and cannot see an under-collection at all. A dump whose manifest and rows
disagree is discarded and re-taken (up to three times, then a loud failure naming the table)
instead of being shipped for the nightly `verify-dump` to red.
