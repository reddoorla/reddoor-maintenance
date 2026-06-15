---
"@reddoorla/maintenance": minor
---

Submission notification emails now include the submission's `extraFields` — the
site-specific context a recipient most needs (the artwork an inquiry is about,
the event an rsvp is for, the company on a contact). Previously these were
stored in Airtable but omitted from the email; now they render as labeled rows
(HTML-escaped, empty values dropped, malformed JSON tolerated).
