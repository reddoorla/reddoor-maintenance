---
"@reddoorla/maintenance": patch
---

Dashboard site editor: cover the fields nothing rendered (#539 Phase 4).

Seven of the eight fields the migration design lists as uncovered are now
editable and rendered — `Netlify ID`, `Search Console property`,
`Newsletter Webhook`, `Mailchimp Audience ID`, `maintenance day`, `testing day`
and `Notify Routing` — with three new field kinds: `url` (the same http(s)
allowlist the deployed-audit target uses), `date` (a real calendar day, so a
rolled-over `2026-02-31` cannot silently reschedule a site), and `notifyRouting`
(validated by `parseNotifyRouting` itself, so the editor cannot store a value the
reader would drop).

`WebsiteRow` gains `notifyRoutingRaw`, the verbatim cell behind the parsed
routing — the same reason `statusRaw` exists. Rendering the re-serialized object
would drop keys the parser ignores and reformat what the operator typed.

The eighth field, `Mailchimp API Key`, is deliberately still absent: it is a live
credential, and every editable field is rendered back into the page carrying its
stored value. It needs a write-only kind first, and a test now fails if it is
added without one.
