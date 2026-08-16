---
"@reddoorla/maintenance": patch
---

Say which side a Prismic model difference is on, and stop two digest tests from
depending on the day they run.

**The `-` lines said the opposite of what they meant.** A model difference the
repo lacked rendered as `- variation rail (REMOVED remotely)`, which reads as
"the remote removed it". The truth is the reverse: Prismic is the side that
still HAS it, the repo is the side missing it, and **pushing is what deletes
it** — taking the document data with it at HTTP 200 and no warning. Read the old
way, an operator goes hunting for who deleted something in Prismic when nobody
did, and merges the push that actually does the deleting.

They now read `- variation rail (only in Prismic — pushing DELETES it)`, naming
the side and the consequence. This is not hypothetical: the line was misread
once on live `reddoor-la` drift, and only settled by reading `compareZone` to
see which argument was local and which was remote. A report line that needs its
source read to be understood is not a report. The `⚠ DESTRUCTIVE` header was
always correct; only the per-line wording was wrong.

**`runDigest` now accepts an optional `now`**, like `collectAttention` already
did. Several collectors it feeds are age-sensitive — `collectPrismicDriftAlerts`
changes an item's key _and_ its wording once a verdict crosses
`PRISMIC_DRIFT_STALE_DAYS` — so a digest test that cannot fix the clock is
asserting on the day it happens to run. Two such tests were written against a
fixture stamped `2026-08-12` and went red four days later, reporting the
staleness wording as though the drift wiring had broken. Production behaviour is
unchanged: omit `now` and the run captures `new Date()` before any await,
exactly as before.
