---
"@reddoorla/maintenance": patch
---

Every write that also copies to Airtable now writes Turso first

Before, the nightly audit write-back, github-signals, the Renovate auto-fix
counter, the Prismic drift sweep, next-due dates, drafting and queueing,
sending (the sent-stamp and the Launch flip), launch, announce,
forms-notify-target, ensure-site and header-image all wrote Airtable first and
Turso second. A failing or hung Airtable write therefore cost the Turso write.

Now Turso lands first, with the identical payload. A failed Airtable copy still
reports exactly where it did before, just after Turso. Pure field builders are
exported for this (`auditFields`, `gitHubSignalsFields`, `nextDueDatesFields`,
`autoFixAttemptsFields`, `prismicModelsFields`, `launchedFields`), and so is a
FieldSet writer (`updateAuditFieldSet`).

When Lighthouse returns no scores, the site's other audit values now reach
Turso. Before, they went only to Airtable.
