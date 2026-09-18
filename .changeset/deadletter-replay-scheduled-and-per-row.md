---
"@reddoorla/maintenance": patch
---

Dead-letter replay no longer loses or duplicates a lead when one row goes wrong: rows are
decoded one at a time (a single undecodable payload used to wedge replay for every other lead)
and a terminal mark that fails to persist is reported as its own loud outcome instead of
aborting the run with the row already re-ingested. `db replay-deadletters` gained `unmarked=`
and `unreadable=` counters on its `DEADLETTER_REPLAY` line and exits 1 for either.
