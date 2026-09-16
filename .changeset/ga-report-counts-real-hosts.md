---
"@reddoorla/maintenance": patch
---

Maintenance reports count only the site's own hostnames.

The GA4 query asked for `activeUsers` with no `dimensionFilter`, so every
environment serving the same analytics tag was counted as traffic to the
site. On reddoorla.com for the thirty days to 2026-09-14 that was 15,971
`localhost` users against 87 real ones — a test suite, reported to the
operator as a 510% rise while real traffic had in fact halved.

The query now filters `hostName` to the site row's own host and its www/apex
twin. A site row with no usable http(s) URL is queried unfiltered as before,
since a filter matching nothing would report zero, which is a worse lie than
reporting noise.
