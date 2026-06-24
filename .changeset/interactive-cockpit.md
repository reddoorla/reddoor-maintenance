---
"@reddoorla/maintenance": minor
---

Interactive cockpit. A "Trigger Renovate" button on repo-backed cockpit cards and
per-site pages (authed `POST /api/sites/:slug/trigger-renovate` → dispatches that
repo's `renovate.yml`; needs `RENOVATE_TOKEN` in the dashboard env, degrades to
"not configured" without it). Plus an inline site-details editor on `/s/<slug>` for
a safe-text + operational field allowlist (Status, cadences, recipients, point of
contact, GA4 id, search query, git repo, copy overrides) via authed
`POST /api/sites/:slug/details` — every field is column-allowlisted and validated
before the Airtable write.
