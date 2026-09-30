---
"@reddoorla/maintenance": minor
---

form-e2e: the probe now fills `required` fields outside name/email/phone/message. A select gets its first non-empty, enabled option; text, checkbox and radio fields get synthetic values; optional fields and the honeypot are left alone. A pass names the fields it synthesized.

The probe also re-adds its `testMode` marker in a capturing submit listener, so a page that re-renders on the click's blur cannot send an unmarked submission, and it refuses to click when the marker is missing from the form just before submit. A field is claimed as synthesized only when the browser accepts the value (pattern, min/max), and a select whose selected placeholder is disabled counts as unfilled.
