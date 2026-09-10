---
"@reddoorla/maintenance": patch
---

match-harness: the three marked blocks become a delimited region that can be corrected on a site that already installed one

`mergeBlock` returned "already done" the instant its marker was present, so the
block's CONTENTS could never change on an installed site (#739). On
`.gitignore` that is not staleness but a brick: the block is a negated whitelist
over `matching/*`, so any harness file at a path it does not re-include is
absent from the commit, `pathsMissingFromHead` refuses the whole install and
reverts it — and widening the whitelist was the one edit that could not land.

`planBlockWrite` replaces it. Each region now carries an END marker as well as a
start, so its extent is addressable; a body that byte-matches the current block
is skipped, one that matches a previously shipped body is replaced IN PLACE
(everything before and after the region preserved byte-for-byte), and anything
else is FLAGGED in the notes and left alone. The region is never assumed to run
to end-of-file, because `sync-configs` appends its own managed block after ours.

The whole point is the site that already installed from 0.95.0: an
un-terminated v1 region is recognised by an exact byte match at the exact offset
its body starts, and the tail after it is the site's own and is kept. So a
0.95.0 site re-runs the recipe once and gets one content-neutral commit — three
files, one terminator line each — after which every later block change lands in
place. This release changes no block body; installing the terminators is its
entire job.
