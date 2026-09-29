---
"@reddoorla/maintenance": patch
---

A site with no CMS no longer blocks its Maintenance report on "CMS Checked" (#911). The item is now `n/a`, which the send gate accepts, when `/health` is fresh but gives no CMS verdict and the nightly Prismic model sweep found no live Prismic config in the site's repository within the last three days. "No live config" means either no config at all or one that names only a placeholder repository. The evidence line reads "No CMS verdict from /health, and the nightly Prismic sweep found no live Prismic config (none, or only a placeholder) in this site's repository". Neither signal counts on its own. What tells a real CMS site apart is `/health`'s own verdict: a site that probes Prismic answers pass or fail, and that verdict always wins. A site whose `/health` gives no verdict stays `unknown` if its sweep failed, never ran or is stale, and a failing probe still fails.
