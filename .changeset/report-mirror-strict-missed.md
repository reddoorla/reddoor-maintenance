---
"@reddoorla/maintenance": patch
---

mirrorReportPatch reports its row count, and a 0-row update is `missed` — logged loose, fatal under the freeze (#647)

`mirrorReportPatch` ended in `.execute()` and threw the row count away, so a
report row that did not exist in Turso mirrored "successfully": the run stayed
green and, post-freeze, nothing converged the miss. Its sibling
`makeSiteMirror` already treated the identical case as `mirrored=missed` —
strict-fatal, because after the flip no importer exists and an absent row is a
bug rather than a wait. The two mirrors disagreed about the freeze's own rule,
and the headline guarantee of b238a19 ("a lost sent-stamp mirror reds the run")
did not hold for a row that was never inserted.

`mirrorReportPatch` now uses `executeTakeFirst()` and returns
`numUpdatedRows > 0n` (an empty patch is `true` — nothing to write is not a
miss). Both boundaries consume it: `mirrorWrite` accepts a `run` that resolves
`false`, logs `mirrored=missed`, and throws under strict; `makeReportMirror`'s
`patch` op logs `mirrored=missed` / throws `no such row in Turso` exactly as
`makeSiteMirror` does. Every caller hands the count through — the send batch's
stamp-sent closure, `approve-report`, `resend-webhook` (now a 500 so Resend
redelivers) and `report-commentary` — so a write for a ghost row reds its
run or request instead of passing.
