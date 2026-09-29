---
"@reddoorla/maintenance": minor
---

form-e2e: the probe now fills `required` fields outside name/email/phone/message. A select gets its first non-empty, enabled option; text, checkbox and radio fields get synthetic values; optional fields and the honeypot are left alone. A pass names the fields it synthesized.
