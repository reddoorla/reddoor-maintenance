---
"@reddoorla/maintenance": minor
---

Record and surface the newsletter fan-out, and tag Mailchimp members by source.

The site-webhook and Mailchimp results were `console.error`-only and persisted
nowhere, so an expired API key or a Mailchimp outage would silently stop signups
reaching the audience while the submission row still read `notify=sent` — healthy
to every view the operator has. Migration `0005_add_fanout_status` adds a
`fanout_status` column; ingest now stamps one `<destination>:<outcome>` token per
attempt (`webhook:ok,mailchimp:401`), and the dashboard shows a red `fan-out:` chip
on the collapsed submission line plus a `Fan-out` detail row. Null still means
nothing was attempted — a non-newsletter form, a spam row, or no destination
configured. The stamp is best-effort like the fan-out itself: a provenance write
never costs a lead.

Members added by the pipeline are now tagged `Online Form` and `form:<type>`, so
form signups are distinguishable from imports and manual adds inside Mailchimp
(every API write otherwise shows the same "API - Generic" source). Mailchimp
ignores `tags` in the member-upsert body for an **existing** member — the common
repeat-signup case — so the tags are also applied through the dedicated tags
endpoint; a tag failure is reported as `mailchimp-tags:failed` rather than failing
the add.
