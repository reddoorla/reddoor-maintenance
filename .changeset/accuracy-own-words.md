---
"@reddoorla/maintenance": minor
---

prospect audit: the accuracy stage records who each statement is about and what kind of fact it is, and holds a contradiction to its two values.

- Each assertion carries `subject` (`prospect`, `other` or `unclear`, defaulting to `unclear` when the model leaves it out), `otherName` for `other`, and `topic` (ratings and reviews, complaints, accreditation, legal entity, ownership, named person, revenue and headcount, street address, or other). The report uses these to print only statements about the business, and to withhold the sensitive topics behind a count. The renderer is reddoorla/reddoor-website#380.
- A `contradicted` verdict now needs `contradiction: { attribute, engineValue, siteValue }`. Code checks that each value is in its own quote, as whole words, and that the two differ. It is no longer held to the shared-word bar, which demoted true contradictions (one year against a different year) to "does not actually say this".
- A `contradicted` verdict about another business, or on a topic we do not check, is stored `unverified` with the values kept, and the reason says why. The reader sees what the answer said without the site being set against it.
- The shared-word support test for `confirmed` ignores the business's own name.
- `siteFullyRead` now means the whole site, by the site's own sitemap: it is true only when the crawl did not stop at its page cap, the sitemap gives an untruncated size and a complete sample, and every sampled page was read. A consumer that printed "we read your whole site" will now print it less often. That is by design: a crawl that stopped at its cap was never the whole site. Otherwise every `absent` becomes `unverified`, with a reason saying why.
- A `contradicted` verdict stands only when both values parse into the same typed form and differ there: a number with its unit, money, a year, a full date, a phone number, a time range, or a place. Two short texts with no figure are compared as text. Anything else is stored `unverified`, with the reason "We could not compare the two values directly." when the values cannot be compared. An unparsed true contradiction is lost from the list; a false one is no longer printed.
- A withheld topic is read off the claim and the engine quote, with the patterns the website's report uses. A row the model filed under `other` keeps the topic those patterns find, so the reader's copy and ours agree.
- An empty or whitespace site quote is no quote: the row says it could not find the passage, and no site quote is stored.
- A page the crawl took but could not read is counted as unread. When that is the reason a site is not read whole, the reason says some pages could not be read, not that they did not match the sitemap.
- A quote that spans two answers is discarded, for statements and for the name-collision quote.
- A malformed `contradiction` from the model no longer fails the stage; that row is stored `unverified`.
- The `"<name> reviews"` probe is off by default. `prospect-audit --reviews` turns it on. A run without it is not comparable with one that asked: the branded-recognition line and the competitor counts cover fewer queries. `reviewsAsked` on the probes result records which.
