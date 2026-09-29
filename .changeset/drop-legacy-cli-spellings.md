---
"@reddoorla/maintenance": minor
---

The last Airtable references are gone

- `--write-airtable` is no longer accepted as a spelling of `--write-back`; cac
  now rejects it as an unknown option.
- `--fleet airtable` is no longer refused by name. It is read like any other
  `--fleet` value, as an inventory file path, and fails when no such file
  exists. Use `--fleet turso`.
- The test suite no longer strips `AIRTABLE_*` variables, since nothing reads
  them.
