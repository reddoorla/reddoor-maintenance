---
"@reddoorla/maintenance": minor
---

`--fleet airtable` is retired

The keyword has read the Turso roster, with a deprecation warning, since #646
step 4. It is now refused with exit 2 and a message naming `--fleet turso`,
instead of being read as an inventory file called "airtable".

Internal only, no API change: the remaining Airtable-named modules moved to
`src/fleet/site-fields.ts`, `src/reports/report-fields.ts`,
`src/db/field-map.ts` and `src/audits/*-fields.ts`, and the unused
`created`/`hasRow` mirror operations are gone.
