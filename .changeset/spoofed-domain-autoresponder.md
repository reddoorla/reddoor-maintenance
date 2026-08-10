---
"@reddoorla/maintenance": patch
---

forms: suppress the autoresponder when the submitter's email is on the site's own domain

A spam bot filled the MSOT contact form using the site's own info@ address as
its email (2026-08-08, spamScore 55 — under the 60 auto-spam threshold). The
"We got your message" autoresponder backscattered into the client's inbox as an
unexplained confirmation. A submitter address on the site's own domain is never
a real outside lead needing a confirmation, so buildAutoresponder now returns
null for it (hostsMatch semantics: exact host or subdomain, case-insensitive,
label-boundary safe; blank/unparseable site url fails open). The POC
notification is unchanged — a human still sees and judges the submission.
