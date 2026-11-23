---
"@reddoorla/maintenance": patch
---

prospect audit: code no longer upgrades an accuracy verdict to `confirmed`. When the model calls a claim `contradicted` and the site uses, exactly, a distinctive term that is part of the claim's own wording, the verdict now comes down to `unverified`, quoting the site around the term, with the reason `Your site does say "<term>", so we have not called this wrong.` It used to become `confirmed`, and it fired on any search term, including the model's own evidence against the claim, so a report could tell a business that its own site says something the site contradicts. A term that is not in the claim, or a negated claim ("no business operates under the name X"), now leaves the model's verdict alone. Only the model, with a quote that survives the substring and support checks, can make a verdict `confirmed`.
