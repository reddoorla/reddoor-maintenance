---
"@reddoorla/maintenance": patch
---

`video`: the phone rendition is capped at `-maxrate 1200k -bufsize 2400k` (was 2200k/4400k), so a 20 s clip lands near 3 MB on a phone instead of 6.
