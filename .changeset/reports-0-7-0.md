---
"@reddoorla/maintenance": minor
---

feat(reports): add the `report` concept — per-site maintenance/testing email reports built from Lighthouse + Airtable, sent via Resend with per-client header inlined via CID. New CLI surface: `reddoor-maint report --due`, `reddoor-maint report <slug>`, `reddoor-maint report <slug> --preview`, `reddoor-maint report --send-ready`. Includes a Netlify webhook function for writing Resend delivery events back to Airtable's `Reports.Delivery status`.

Operator flow: cron `--due` drafts overdue reports → operator reviews HTML attachment on Airtable mobile, fills in the two GA user-count fields, flips `Approved to send` → cron `--send-ready` sends → webhook updates `Delivery status`.

Required env: `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `RESEND_API_KEY` (CLI); `RESEND_WEBHOOK_SECRET` (webhook only). See `.env.example`.

Deferred to 0.7.1: GA Data API automation (manual entry in Airtable mobile for now).
