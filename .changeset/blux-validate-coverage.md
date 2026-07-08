---
"@reddoorla/maintenance": minor
---

blux validate: deterministic content-coverage check against the export

New `blux validate <exportDir> --against <rendered.html | url>` action. The
export's `index.html` is the answer key; the command extracts its visible
text runs and reports which appear in the converted site's rendered HTML, so a
conversion's fidelity is a one-command coverage score instead of a per-page
eyeball. On the live the-pointe render it scores 81% and names the real gaps
(un-migrated hero overlay copy, portfolio section labels), spending zero
tokens to find them. Matching folds case, entities, and punctuation to
compare words rather than typography.
