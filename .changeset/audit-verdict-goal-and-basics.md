---
"@reddoorla/maintenance": minor
---

prospect-audit: measure the answer space, the visitor journey and what is broken

New in the report, all stored on `result_json`: `goalFit` (the site's primary
goal, inferred by the model or set with the new `--goal` flag, and the concrete
things a site with that goal needs), `basics` (reachability, redirects, mixed
content, duplicate titles, and what each named AI crawler is served),
`assets` (broken links and images), `journey` (click distance from every crawled
page to a way of making contact) and `consistency` (copyright currency, pages
off the site template, and an inventory of the contact details published).

Findability is reweighted: `llms.txt` no longer scores, because nothing we can
observe reads it. Reports stored before this release carry none of the new
fields, and a reader must treat their absence as "not measured" — not as a
finding.

Two rules the new checks are held to, both of which cost checks that were
already written: a check reports an ANSWER, never a topic that happens to be
mentioned; and our own missing data — a refused fetch, a rate limit, a render
that timed out, a link into CDN infrastructure — is never reported as the
prospect's defect.
