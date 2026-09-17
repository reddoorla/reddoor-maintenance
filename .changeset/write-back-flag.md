---
"@reddoorla/maintenance": minor
---

Rename the `--write-airtable` flag to `--write-back` on `audit`, `prismic-models`, `header-image` and `github-signals` (#698). The old name described the store the flag once wrote to; since the Turso flip it writes the site's row in Turso and mirrors the Airtable shadow, and the name was misleading the people and agents who read it. `--write-airtable` (including `--write-airtable=<slug>`) keeps working: it is rewritten to `--write-back` before parsing, prints a one-line note on stderr, and no longer appears in `--help`.
