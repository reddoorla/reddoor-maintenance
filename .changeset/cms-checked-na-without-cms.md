---
"@reddoorla/maintenance": patch
---

A site with no CMS no longer blocks its Maintenance report on "CMS Checked" (#911). The item is now `n/a`, which the send gate accepts, when the nightly Prismic model sweep found no Prismic config in the site's repository within the last three days and `/health` gave no CMS verdict. The evidence line reads "No CMS: the nightly Prismic model sweep found no Prismic config in this site's repository". `/health`'s `prismic: "skipped"` alone is not taken as proof, because a Prismic site on a placeholder repository gives the same answer. A site with a CMS whose probe has not reported stays `unknown`, and so does a site whose sweep failed, never ran or is stale. A failing probe still fails.
