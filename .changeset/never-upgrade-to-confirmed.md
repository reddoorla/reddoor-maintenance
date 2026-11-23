---
"@reddoorla/maintenance": patch
---

prospect audit: code no longer upgrades an accuracy verdict to `confirmed`. When the model calls a claim `contradicted` and the site uses one of that claim's distinctive search terms exactly, the verdict now comes down to `unverified`, keeping the site passage and the reason `Your site does say "<term>", so we have not called this wrong.` It used to become `confirmed`, so a report could tell a business that its own site says a thing the model had found the site contradicts. Only the model, with a quote that survives the substring and support checks, can make a verdict `confirmed`.
