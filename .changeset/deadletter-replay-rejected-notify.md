---
"@reddoorla/maintenance": patch
---

`db replay-deadletters` no longer counts a lead the store rejected on replay, or a lead placed without its notification email, as `replayed`. Its marker is now `DEADLETTER_REPLAY replayed=… rejected=… notify_failed=… still_failing=… unmarked=… unreadable=…`, each REJECTED and NOTIFY FAILED row gets its own line, and the command exits 1 for either. The forms-deadletter-replay workflow reds on both, names the rows in its tracking issue, and a later green run does not close an issue that names one (#1615).
