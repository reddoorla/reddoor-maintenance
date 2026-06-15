---
"@reddoorla/maintenance": minor
---

Newsletter submissions can now be added directly to a per-site Mailchimp audience
(no Zapier hop) when the site's new `Mailchimp API Key` + `Mailchimp Audience ID`
Airtable columns are set. The dashboard ingest upserts the subscriber
(`PUT /lists/{id}/members/{hash}`, idempotent, `status_if_new: subscribed`)
best-effort — never blocking or failing the submission. The generic
`Newsletter Webhook` remains available for other integrations.
