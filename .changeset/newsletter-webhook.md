---
"@reddoorla/maintenance": minor
---

Newsletter submissions now fan out to a per-site webhook (e.g. a Zapier Catch
Hook) when the site's new Airtable `Newsletter Webhook` column is set. The
dashboard ingest POSTs newsletter-formType submissions to that URL best-effort
(https-only, never blocks or fails the submission). Sites without the column set
are unaffected.
