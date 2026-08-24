---
"@reddoorla/maintenance": minor
---

feat(db): the reports read layer + Turso-served report previews (#539 Phase 2)

`listAllReports` / `listReportsForSite` / `getReportHtml` read reports from
Turso in the exact `ReportRow` shape the Airtable module returns, pinned by the
same reader-equivalence instrument as sites. The stored stable-key checklist is
re-keyed back to the Airtable column names consumers expect. `renderedHtml`
links now point at the dashboard's own `/api/reports/:id/preview` route
(serving `rendered_html` straight from Turso, behind operator Basic auth)
instead of Airtable's expiring signed URLs — stale dashboard tabs no longer
404 their preview links. Also fixes the importer double-encoding the
`Checklist auto-evidence` long-text cell (a string of JSON was
JSON.stringify-ed again, which would have read back as null evidence); the
hourly sync converges existing rows on its first post-deploy pass.
