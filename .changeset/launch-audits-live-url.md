---
"@reddoorla/maintenance": patch
---

`launch` audits the site row's live `url` instead of the local checkout's dev server, so the Lighthouse scores stored in `site_health` and mailed in the go-live email are the production site's. The dev guard, whose `/health` control proves the url answers, now runs before the audit: a url that does not answer, or is not http(s), stops the launch without auditing anything.
