---
"@reddoorla/maintenance": patch
---

A namesake is a brand collision, not a competitor, and cited domains name the query that produced them (#601)

The first real audit's most-cited domain — 13 citations, more than anyone else —
was a different agency two thousand miles away wearing essentially the prospect's
name. Both branded answers opened by disambiguating between several same-named
agencies. That is arguably the most valuable thing the audit surfaced, and it
rendered as one anonymous row in a list headed "Who the engines cited instead".

`isNamesake` now identifies a cited domain whose own label carries the
prospect's business name, optionally trailed by a single category word — which
is exactly how the real case presented (`reddoorcreativemarketing.com`). It is
gated on `isDistinctiveName` for the same reason that function exists: a
prospect called Summit shares a label with half the internet, and "a different
business is using your name" has to survive the prospect reading the domain
printed underneath it.

`ProbesResult.namesakes` is a subset of `competitorsSeen`, deliberately not
subtracted from it: that field is what stored reports and the renderer already
read, and changing what it contains would rewrite documents that have already
been sent. The renderer is what separates the two — namesakes get their own
call-out, and the competitor list prints the remainder, each domain now naming
the queries it actually came back on rather than arriving as one merged list
disconnected from the searches that produced it.

The field is optional, so a report stored before it existed reads as "not
measured" rather than "no namesake".
