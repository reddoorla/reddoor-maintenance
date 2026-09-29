---
"@reddoorla/maintenance": patch
---

A report whose site matched no Search Console property now stores `search_found_page1` as NULL ("not measured") instead of 0 ("not on page 1"), on the draft create path and on the announce create and reuse paths. A property-found miss still stores 0. No rendered surface changes: every reader shows NULL and 0 the same way; only the stored value differs.
