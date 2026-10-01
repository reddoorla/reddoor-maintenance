---
"@reddoorla/maintenance": patch
---

`roster-urls` reads a roster url a second time, after a 25 s pause, when its first read got no HTTP answer at all (a timeout, a DNS failure, a reset connection or a TLS error). The second read is the verdict that gets stored. A url that answered with an HTTP 4xx or 5xx, with Netlify's site-not-found page, or that is not an http(s) url, is not read again, and neither are the two controls. Each retried url gets a `::notice::` line, and `ROSTER_URL_SUMMARY` gains `retried=N`.
