---
"@reddoorla/maintenance": minor
---

feat(reports): default Search Console query to site name + flag name-default misses

Search-presence enrichment no longer requires a hand-entered `Search query`
per site. When the Airtable `Search query` cell is empty (or whitespace),
`fetchSearch` falls back to the site's name as the brand query, so every
GA-enrolled site (one with a GA4 property ID or an explicit query) gets brand
search tracking automatically. An explicit `Search query` still wins when set.

Sites where the site-name default returns no Search Console data are flagged —
a per-site `⚑` log line plus a one-line batch summary
(`⚑ N site(s) returned no Search Console data for their name …`) — so the
operator knows the handful whose legal name differs from their brand phrasing
and needs a hand-tuned query. The flag is deliberately separate from the
GA/Search soft-fail (outage) signal: a clean "no data for the name" is a
tuning hint, not an analytics failure, so it never trips the analytics-health
alarm. A site that is found but ranks below page 1 is a valid measurement, not
a miss, and is not flagged.
