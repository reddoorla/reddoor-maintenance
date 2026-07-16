---
"@reddoorla/maintenance": patch
---

Extend the WAF-challenge honesty discipline (#428) to the crossbrowser/mobile verdicts (challenge-poisoned engine/device checks are voided against verified reachability) and the link checker (challenge-shaped link statuses get a plain-fetch cooldown re-check before counting broken); all three verdicts now name their offenders in details and the evidence note.
