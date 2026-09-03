---
"@reddoorla/maintenance": minor
---

Form auto-replies can now be authored in a site's CMS.

A site may forward a `_reply` envelope with a submission — subject, body
paragraphs, signature, and calendar details — and the autoresponder renders it,
attaching an RFC 5545 invite and a Google Calendar link when the envelope
carries an event. Sites that send nothing keep today's email exactly, and an
RSVP now names its event in the subject even with no copy authored at all.

`@reddoorla/maintenance/forms/prismic` resolves that envelope from a Prismic
repository: per-form-type defaults from a `form_replies` singleton, overridden
per event. Its client is structurally typed, so the package still depends on no
CMS SDK and `./forms` stays importable by a site that uses none.

Two fixes ride along. `buildPayload` may now be async, and a rejected one is the
documented 400 rather than an unhandled rejection. And reserved underscore keys
can no longer be smuggled into `extraFields` from a request — previously any
unrecognized `_`-prefixed key was folded in, which would have let a bot dictate
the text of an email sent from `forms@reddoorla.com`.
