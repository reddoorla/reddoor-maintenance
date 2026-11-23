---
"@reddoorla/maintenance": patch
---

prospect audit: the accuracy stage's name-collision verdict now records whether the answer settled which business it means. `conflation.settled` is true when the answer named this business by its own place, work or site and kept the others apart, and false only when it said it could not tell, asked which one was meant, described something else as this business, or mixed their facts. The old definition ("more than one business under this name") counted an answer that correctly identified the prospect and then set an unrelated acronym homonym apart, and called every other name a business. `otherNames` now carries what each other thing is in the answer's own words, which need not be a business. A model that omits `settled` reads as settled, so it is never a finding by default. The report renders the finding only for `detected && !settled`.
