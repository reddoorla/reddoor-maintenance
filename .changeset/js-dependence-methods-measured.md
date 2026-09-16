---
"@reddoorla/maintenance": patch
---

The report's JS-dependence copy says what we measured, not what we assumed (#675)

Readability gives JS dependence 60 of its 100 points, and the report justified
that to the client with "Most AI crawlers do not run JavaScript" — an inference
from the Vercel/MERJ crawler study of December 2024, which measured index
crawlers on one host's network and says nothing about what our own instrument
reads at answer time. That was our assumption printed as a fact about a
stranger's site.

The experiment is now in `docs/aeo-evidence-base.md`, with the fixtures and all
nine raw transcripts under `docs/experiments/js-dependence/`. Three pages
identical but for where one nonce fact lives — server HTML, inside a script tag,
and behind a runtime `fetch` — probed three times each. The control returned its
fact 3/3, so the negatives are worth something; text written at runtime came back
`NOT STATED` 3/3, and the transcripts show the model never requested the data
file it could see referenced in the script source.

So the premise holds and the weight stays at 60. Only the copy changes: both the
readability paragraph and the score-card hint now cite the controlled result
rather than asserting a fact about crawlers in general.

Two things the experiment found that the weight does not yet reflect, recorded in
the evidence file rather than silently fixed: `extractPage` does not walk script
contents, so a page shipping its text inside `<script type="application/json">`
(every stock Next.js and Nuxt page) is scored as fully JS-dependent even though
the probe read that text 3/3 — a real over-penalty on a common stack. And the
audit's probe engines never fetch the prospect's page at all (`WebFetch` is in
`BASE_DISALLOWED`; `claudeWebSearchEngine` only runs `web_search`), so the
experiment the issue described could not be run as written.
