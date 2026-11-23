---
"@reddoorla/maintenance": patch
---

prospect audit: code no longer overrides the model's accuracy verdict. A rule turned the model's `contradicted` into `confirmed` whenever the site used one of the claim's search terms, including the model's own evidence against the claim, so a report could tell a business that its own site agrees with something the site contradicts. That rule is gone, and no replacement takes its place: the model's verdict and its own quote stand, under the usual quote checks. Only the model can make a verdict `confirmed` or `contradicted`.
