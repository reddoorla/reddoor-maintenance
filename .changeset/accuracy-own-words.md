---
"@reddoorla/maintenance": minor
---

prospect audit: the accuracy stage records who each statement is about and what kind of fact it is, and holds a contradiction to its two values.

- Each assertion carries `subject` (`prospect`, `other` or `unclear`, defaulting to `unclear` when the model leaves it out), `otherName` for `other`, and `topic` (ratings and reviews, complaints, accreditation, legal entity, ownership, named person, revenue and headcount, street address, or other). The report uses these to print only statements about the business, and to withhold the sensitive topics behind a count.
- A `contradicted` verdict now needs `contradiction: { attribute, engineValue, siteValue }`. Code checks that each value is in its own quote, as whole words, and that the two differ. It is no longer held to the shared-word bar, which demoted true contradictions (one year against a different year) to "does not actually say this".
- The shared-word support test for `confirmed` ignores the business's own name.
- `siteFullyRead` is true only when the site's own sitemap gives a size and the pages read reach it. Otherwise every `absent` becomes `unverified`, with "We read P of your S pages" or "could not learn how many your site has".
- The `"<name> reviews"` probe is off by default. `prospect-audit --reviews` turns it on.
