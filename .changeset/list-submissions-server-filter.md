---
"@reddoorla/maintenance": patch
---

Per-site submissions are now fetched with a server-side `{Site}` filter, a
newest-first sort, and a bounded `maxRecords`, instead of paging the entire
`Submissions` table on every site-dashboard load and filtering in JS. This
removes the one unbounded full-table scan in the request path as the fleet's
submission volume grows. Internal only — no public API change.
