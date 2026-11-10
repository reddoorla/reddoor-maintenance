---
"@reddoorla/maintenance": minor
---

form-e2e covers a form off /contact. A site lists the routes whose forms forward the testMode marker in its /health `forms.paths` (e.g. `["/join-the-team"]`), and the probe submits there when /contact and / have no form. When none of those carries a form, the probe looks, without submitting, at up to 14 sitemap routes: a form found there is reported as "form at <path> is not declared in /health forms.paths" and listed UNCOVERED by the nightly, so "no contact form (n/a)" now means no form was found on any of them, and says how many it looked at.
