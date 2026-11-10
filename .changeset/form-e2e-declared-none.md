---
"@reddoorla/maintenance": minor
---

form-e2e reads a `forms.none: true` declaration from a site's /health: a site with no form at all is checked by a look at /contact and / (nothing filled or submitted) and gets the n/a verdict when none is found, instead of self-skipping as undeclared every night. A form found, or a look that could not run, keeps the site on the UNCOVERED line with the reason.
