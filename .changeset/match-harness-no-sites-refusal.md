---
"@reddoorla/maintenance": patch
---

match-harness: `--fleet` over an inventory naming nobody refuses instead of exiting 0 over nothing (#738)

`runRecipeOverSites` joins zero result rows into the empty string, so
`match-harness --ref <url> --fleet <inventory>` over an inventory that resolved
no sites printed one blank line and exited 0. Measured before the change: exit
code 0, output one empty line. A success exit over no rows at all is
indistinguishable from "every site already had the harness", and an Airtable
view filter, an empty JSON file or a dynamic inventory returning `[]` all
produce exactly it.

The command now opens with the same refusal `prismic-ci` does — name the
condition, name the likely causes, exit 1 — before `prepareFleetSites` clones
anything.
