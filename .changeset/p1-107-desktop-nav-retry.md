---
"@reddoorla/maintenance": patch
---

browser audit: a desktop navigation that throws now gets one retry, in a fresh context, capped at 10 s, as mobile's does. A route that throws twice still fails, and a page that loaded but failed is never retried. (#2012)
