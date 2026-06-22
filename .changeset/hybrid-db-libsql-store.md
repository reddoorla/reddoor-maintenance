---
"@reddoorla/maintenance": minor
---

Add a libSQL-backed store for the two high-volume data sets — form submissions and
spam screen-out counters — behind the existing dependency-injection seam, plus a
`reddoor-maint db migrate|backfill|reconcile` CLI. Screen-out counters are now exact
(atomic upsert) instead of approximate daily buckets, and per-site submission reads are
indexed server-side. Airtable remains the human back office for Websites, Reports, and
Digest State. Handlers are not yet switched — that lands in the cutover.
