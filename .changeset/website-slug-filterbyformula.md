---
"@reddoorla/maintenance": patch
---

fix(airtable): `getWebsiteBySlug` narrows the fetch with a `filterByFormula` (replicating `siteSlug` on `{Name}`, capped at one record) instead of paging the whole table per request, and validates the slug to keep URL input out of the formula.
