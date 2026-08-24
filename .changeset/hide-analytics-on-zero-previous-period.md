---
"@reddoorla/maintenance": patch
---

Hide the report ANALYTICS box when the previous GA period is a literal 0: a zero
last period means the tag wasn't collecting for a full window (new property or
mid-window install), so the count/trend is partial-window noise. A search body
line still keeps the block alive (count suppressed); `previous === undefined`
(GA gave no prior window) is unchanged and still shows the count.
