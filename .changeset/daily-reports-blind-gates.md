---
"@reddoorla/maintenance": patch
---

`report --send-ready` reds by name on an approved, unsent report the send queue cannot see (not draft-ready), and on an empty queue read from a store with no sites. The digest's `DIGEST_SEND_LOG` line gains `read=ok|absent|corrupt|failed`, and a corrupt digest snapshot prints `DIGEST_STATE_READ snapshot=corrupt`. The daily-reports workflow now gates `NEXT_DUE_WRITE` in the draft step, reds on a send-log read that was corrupt or failed, and warns on a corrupt snapshot (#1613).
