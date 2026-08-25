---
"@reddoorla/maintenance": patch
---

Prospect audit: ask the visibility engines a search, not a question about the site.

The first production audit scored its subject 0 on AI Visibility, and two of the
three category probes explain why. The probe stage was seeded with
`AnalyzeResult.buyerQuestions` verbatim — questions the analyze pass writes *about
the prospect's site*, where "What services does this agency actually offer?" and
"Where are they located?" read perfectly well beside it. Sent to a live engine on
their own, with no other context, they have no antecedent. One came back "I don't
have any context about who 'they' refers to"; the other opened by looking for an
uploaded file. Neither measured the prospect. The score measured our own prompt.

`AnalyzeResult` now carries a separate `categoryQueries`: 3-5 standalone searches
a buyer types *before* they have heard of the company, which must never refer to
it — not by name (the engine just echoes the name back, measuring nothing) and not
by pronoun. `buyerQuestions` keeps its conversational phrasing, which is correct
for the report's Answers section and was never the problem.

The two uses had been sharing one field since the stage was written; the schema
comment noted the dual purpose but the prompt only ever described the first one.

`ProbeInput.buyerQuestions` is now `ProbeInput.categoryQueries`. `buildQueries`
passes these through untouched, so nothing downstream can repair a query that
arrives malformed — a test pins that guarantee at the boundary, and the schema
rejects a thin array rather than letting it silently starve the probe stage and
read out as a prospect who never surfaces.
