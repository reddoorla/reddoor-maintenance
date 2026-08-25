---
"@reddoorla/maintenance": patch
---

fix(reports): read the newest header attachment, and refresh it in `announce`

Both header readers took `attachments[0]`, but Airtable's `uploadAttachment` appends, so
the newest file is the tail — a field that ever stacked served its oldest image forever.
`reports/airtable/websites.ts` and `db/header-images.ts` now take the tail, keeping the
send path and the Turso mirror in step.

`announce` never refreshed the header, so a site whose stored header predated a plate
change kept announcing with the old one until an unrelated Maintenance/Testing draft
healed it. It now refreshes like `draftReportForSite`, with the same `refreshHeader: false`
opt-out for unit suites.
