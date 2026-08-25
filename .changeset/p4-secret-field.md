---
"@reddoorla/maintenance": patch
---

Dashboard site editor: the Mailchimp API key, as a write-only field (#539 Phase 4).

The last of the design's eight uncovered fields, and the only live credential
among them. A new `secret` kind makes it editable without ever sending the stored
value to the browser: the control renders with no `value` attribute, and its
placeholder reports only whether a key is set.

An empty submission means "leave unchanged", not "clear". Every other kind clears
on empty, but this input is blank on every page load by construction, so
clear-on-empty would let any unrelated save destroy a working key. `setSiteDetail`
returns a new `unchanged` status and never touches the record.

Known limitation: the console therefore cannot CLEAR a key, only replace it —
clearing is an Airtable action today. That needs revisiting at the Phase 5 freeze,
when Airtable stops being available as the fallback path.

This completes editor coverage for all eight fields the design named.
