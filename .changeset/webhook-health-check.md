---
"@reddoorla/maintenance": patch
---

feat(webhook): GET health-check on `/resend-webhook` + Netlify deploy procedure in README

`GET /.netlify/functions/resend-webhook` now returns a JSON envelope reporting which of the three required env vars (`RESEND_WEBHOOK_SECRET`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`) are present on the deployed Netlify function. Lets operators curl the deployed URL right after wiring env vars and confirm the function is reachable + env is wired before doing any Resend webhook configuration. Reports presence-only — secret values are never echoed (test asserts this).

README gains a full **Webhook deployment** section under Reports with the click-by-click: create site → set env vars → trigger deploy → curl health → register in Resend → end-to-end smoke against ERP Industrials.

POST behaviour unchanged.
