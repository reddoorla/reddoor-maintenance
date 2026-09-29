---
"@reddoorla/maintenance": minor
---

New `reddoor-maint roster-urls --fleet --write-back` (#912): one GET (redirects followed, 15 s) of every non-archived roster `url`, whatever the row's status, stored in `site_health` as `url_resolves` (`pass` for a final 2xx, `fail` for anything else, NULL for a blank url), `url_status` (the code, `404 netlify-site-not-found` for Netlify's unclaimed-host page, `error: <code>`, `not an http(s) url` or `no url`) and `url_checked_at`, stamped on every outcome. Two controls run first, a host Netlify does not serve and a deployed site; if either misreads, nothing is written and the run exits 1. A failing row prints a `::warning::` and is a finding, not a failed run. The nightly `fleet-lighthouse` runs it after the GitHub-signals sweep. Migrations `0030`–`0032` add the three columns. Nothing reads them yet; the digest surface is a follow-up.
