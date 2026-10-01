---
"@reddoorla/maintenance": patch
---

`launch` audits the site row's live `url` instead of the local checkout's dev server, so the Lighthouse scores it stores in `site_health` and on the Launch report row are the production site's. The dev guard, whose `/health` control proves the url answers, now runs before the audit: a url that does not answer, or is not http(s), stops the launch without auditing anything, and a live audit that fails never falls back to the checkout.
