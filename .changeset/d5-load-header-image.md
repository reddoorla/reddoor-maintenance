---
"@reddoorla/maintenance": patch
---

D5: read stored header images back out of Turso.

`storeHeaderImage` has been dual-writing since the header-image CLI landed, and
the one-shot backfill copied the rest — production carries a BLOB for 12 of the
13 maintained sites. But nothing could read the bytes back, so every consumer
still fetched Airtable's signed attachment URL and the columns were write-only in
practice.

`loadHeaderImage(db, siteId)` closes that. It is a separate query from the site
read on purpose: `getSiteBySlug` excludes the BLOB because it is 0.6–0.8 MB per
site, so reading the bytes has to be an explicit per-site act rather than a field
that arrives for free on every dashboard GET.

Also corrects two module comments that claimed these columns were empty
fleet-wide. That was true when written and has not been since.
