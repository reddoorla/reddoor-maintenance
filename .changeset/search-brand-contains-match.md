---
"@reddoorla/maintenance": minor
---

Search Console brand matching is now robust to phrasing. The report/announcement
"brand search position" no longer depends on the operator typing the exact query
string: the `Search query` is treated as a case-insensitive **substring hint**
(`contains` instead of `equals`). Among the matching user queries we report the
position of the **exact-match query when present** (a precisely-configured brand query
is honored verbatim — no longer-tail variant can hijack the number), otherwise the
**most-searched** matching query (highest impressions, tie-break best position). New
exported `pickBrandQuery` (most-searched) and `selectBrandPosition` (exact-first then
fallback). So "red door creative" is honored exactly, "red door" still resolves to the
brand's top query, and a near-miss like "reddoor creative la" no longer silently returns
nothing. Backward-compatible — an exact string contains itself, so every currently-working
site keeps its result.
