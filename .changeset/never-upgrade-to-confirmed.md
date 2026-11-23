---
"@reddoorla/maintenance": patch
---

prospect audit: code no longer upgrades an accuracy verdict to `confirmed`. A rule turned the model's `contradicted` into `confirmed` whenever the site used one of the claim's search terms, including the model's own evidence against the claim, so a report could tell a business that its own site agrees with something the site contradicts. Now only the model can make a verdict `confirmed`. Code takes a `contradicted` down to `unverified` (quoting the site around the term, with the reason `Your site does say "<term>", so we have not called this wrong.`) only when all of these hold: the claim denies nothing; the term carries every name the claim asserts, apart from the business's own; and the model's own quote does not already contain the term. In every other case the model's verdict and quote stand, under the usual quote checks.
