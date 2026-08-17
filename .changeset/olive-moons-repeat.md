---
"@reddoorla/maintenance": minor
---

Skip all spam handling for sites whose status is `in development`.

Building a site means testing its form — from one address, across several
unrelated sites, minutes apart. That is exactly the cross-site repeat-sender
signature `ingestSubmission` is built to catch, so a site under construction
reliably auto-spammed its own builder's test submissions: the row landed
`spam_auto`, notify was skipped and the cockpit hid it, which is indistinguishable
from a broken form.

An `in development` site has no real visitors, so spam handling there protects
nothing. Content scoring, the required-Turnstile escalation, the cross-site
repeat-sender scan and the duplicate/spray scan are now all skipped for those
sites — including their retroactive re-bucketing of rows belonging to _other_
sites, which a test submission has no business triggering. Behaviour on every
other status is unchanged.
