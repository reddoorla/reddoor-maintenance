---
"@reddoorla/maintenance": minor
---

feat(db): header images land in Turso — design D5 completed (#539 Phase 2)

New `db backfill-header-images` copies every site's current Airtable "Header
image" attachment into `sites.header_image*` (idempotent — a populated BLOB is
never overwritten, so a re-run can't clobber a freshly generated image), and
the header-image CLI's `--write-airtable` now dual-writes: every upload also
lands the bytes in Turso, stamped with the generation time. This makes the
read layer's `headerImage` real, unblocking the cockpit and approve-report
repoints whose preflight reads it.
