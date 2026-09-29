---
"@reddoorla/maintenance": patch
---

A report whose site matched no Search Console property now records the Google Indexed row as `unknown`, with the note "No Search Console property matched this site". It used to record `fail: Not on page 1`, a verdict on a ranking the lookup never measured. On a Testing report the row still blocks the send, now for the real reason; on a Maintenance report it stays advisory. A property that is found and ranks off page 1 is still `fail`.
