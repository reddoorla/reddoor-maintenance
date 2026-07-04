---
"@reddoorla/maintenance": minor
---

New `ensure-site <slug>` command: find-or-create the Airtable Websites row for
a new site (Status "in development", Git repo default `reddoorla/<slug>`),
fill-blanks-only on re-run so operator edits are never clobbered. Day-one step
of the /new-site bootstrap workflow — the row makes audits, form-ingest slug
resolution, and reports work from birth.
