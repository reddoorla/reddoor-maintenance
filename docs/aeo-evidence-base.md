# AEO evidence base

What the published research supports about getting cited by AI answer engines —
and, for each finding, what our audit does about it.

**Compiled 2026-08-26.** Every claim carries a source and a date. Nothing here is
derived from our own `prospect_audits` table; see the last section for why.

**This document has been through an adversarial review.** Four independent
fact-checkers were asked to refute it, not confirm it. They refuted a great deal
— including two statistics that turned out not to exist, a headline figure read
backwards, and a table of mine that silently dropped nine of twenty-three rows,
three of them inconvenient. What follows is the corrected version. The section
"Claims that do not survive tracing" is the most useful part of it.

---

## How to use this

1. **Almost all of this is correlation, and much of it is one practitioner's
   judgement.** Where a genuinely causal design exists — a matched before/after
   — it is labelled CAUSAL and outranks any correlation.
2. **Age matters more here than in most fields.** Engine behaviour changes in
   weeks. Anything over a year old needs a re-check before a client sees it.
3. **Prefer the study that measured the thing over the blog that summarised it.**
   I broke this rule twice in the first draft and it cost me both times. If a
   number reached us through a summary, say so.
4. **Never quote a figure you have not traced to a primary.** Most published AEO
   statistics are laundered. See the tracing section.

---

## Settled — safe to say to a client

### AI crawlers do not execute JavaScript

The most actionable finding here, and the only one that directly underwrites a
heavy weight in our scoring.

- Vercel + MERJ, **17 Dec 2024**: **none** of GPTBot, OAI-SearchBot,
  ChatGPT-User, ClaudeBot, Meta-ExternalAgent, Bytespider, PerplexityBot or CCBot
  render JavaScript. On `nextjs.org` they _fetch_ JS files — 11.50% of ChatGPT's
  fetches, 23.84% of Claude's — and never execute them.
- **Google renders.** Gemini and Search share Googlebot's crawl; Google confirms
  `Google-Extended` has no separate user agent and governs grounding as well as
  training. Vercel could not measure Gemini separately (it counts "Googlebot: 4.5
  billion fetches across Gemini and Search"), so this is an infrastructure
  inference, not an observation. **AppleBot** renders too ("may render the
  content of your website within a browser" — Apple's own docs).
- **Not re-tested since.** As of Aug 2026 this is still the _only_ published
  measurement. Every 2025–26 write-up restates it rather than re-running it — one
  says so outright: _"we're summarizing published third-party tests… not a study
  of our own."_ No vendor (OpenAI, Anthropic, Perplexity) documents rendering
  behaviour **in either direction**, so "nobody has announced JS rendering" is an
  absence of documentation, not a confirmation. Treat the finding as 20 months
  old and unrefreshed.
  - _An earlier draft of this document claimed it had been "independently
    re-confirmed mid-2026". That was false, and the phrasing was lifted from an
    uncited agency blog. It is the exact failure Rule 3 exists to prevent._
- **Limits Vercel does not lead with:** measured on `nextjs.org` plus two job
  boards (one Next.js, one custom), all on Vercel's own CDN, by a vendor whose
  recommended fix is server-side rendering — which Vercel sells. Microsoft Copilot
  was excluded for lacking a unique user agent. Data window ≈ Nov–Dec 2024.
- **Caveat that survives:** content in the _initial HTML response_ — inline JSON,
  streamed React Server Components — can still be read. "Uses React" is not the
  finding; "the text only exists after hydration" is.
- **The growing exception:** agentic browsers _do_ render. ChatGPT Atlas,
  Operator and Claude's built-in browser are real Chromium instances. They are
  user-driven, not indexing crawlers, so they don't change the citation argument
  — but "AI can't run your JavaScript" is false if a client tests it in one.

**Our audit:** the `jsDependence` check, **60 of 100 readability points**. The
finding is externally supported; **the 60-point weight is our judgement and is
not.** Zyppy's nearest analogue (#14 Content Visibility, 7.6, attested by 14 of
54 sources) is supporting evidence for it.

### A crawler's robots.txt access is not the same as its actual access

Not from the literature — measured directly, and it found a defect in our own
product.

`ludlowkingsley.com` publishes a robots.txt blocking nothing relevant, and
returns **403 to ClaudeBot on 8 of 8 requests** at the Cloudflare edge, while
serving a browser, GPTBot, PerplexityBot and our own audit agent 200. Our report
said "every AI crawler we checked can reach the site" — while probing their
visibility with the one engine their CDN turns away.

Context: Cloudflare proxies roughly a quarter of the web, has a one-click
"block AI bots" toggle, and can prepend its own directives to a site's
robots.txt — so the file you fetch may not be the file the owner wrote.

**Our audit:** fixed. `basics.ts` now fetches the homepage as each documented
crawler UA and compares against a browser control; the emailed report says
"nothing in your robots.txt blocks the AI crawlers we checked" rather than
claiming they can reach it. Two implementation notes that cost real time:
**use the vendors' exact UA strings** (an invented `GPTBot/1.2 (+…)` drew a 403
that vanished with the real Mozilla-prefixed string — bot management matches the
whole header), and **never probe `Google-Extended`**, which is a robots.txt
control token with no user agent at all.

### AI crawlers waste a large share of their fetches on missing URLs

Vercel/MERJ, same study: ChatGPT **34.82%** of fetches on 404s, Claude
**34.16%**, ChatGPT a further **14.36%** on redirects — against Googlebot's
**8.22%** and **1.49%**. Roughly four times Googlebot's rate.

**Read the cause before using it.** Vercel attributes the bulk to `robots.txt`
probes and _"outdated assets from the `/static/` folder"_ — stale hashed build
files on a Next.js site, not missing content pages — and its own recommended fix
is sitemaps, redirects and consistent URL patterns, not status codes. Soft-404s
are never mentioned in the study.

**Our audit:** the `notFound` probe stays, on its original argument — a dead end
loses a visitor, and a soft-404 returning `200` puts a "not found" page into any
index that fetches it. _An earlier draft called Vercel's 34% "a second, stronger
reason" for that check. It is not: it measures a different failure._

---

## Genuinely uncertain — useful for calibration, not for claims

### The citation "ranking factors" list

Cyrus Shepard / Zyppy, **May 2026**. Widely cited, including by me, as a
"meta-analysis of 54 studies". It is not one, and the adversarial review audited
his public scoring sheet to show it.

**What it actually is:** a hand-scored review of 54 hand-picked sources — 10
preprints/papers, 3 patents, 2 Google docs pages, and **39 commercial SEO-vendor
blog posts**, several by the same authors (one consultant appears six times, and
his first criterion is "repeatability across different studies"). Shepard assigns
each factor a 0–10 score by hand, "using AI to help adjust the final numbers",
and says so twice. His published scores correlate only **ρ≈0.4** with his own
tabulated evidence — under a quarter of the ordering is explained by the data.

**Read the scores as one experienced practitioner's confidence ranking. Never as
an effect size, and never as a justification for a weight in our scoring.**

His top of list: URL accessibility 9.5, search rank 9.4, fan-out rank 9.3,
preview control 9.2, query-answer match 9.2, intent-format match 9.0, topic
cluster rank 8.9, answer near the top 8.8, AI-ready structure 8.6 — then
factually specific 8.3, explicit phrasing 8.1, cites sources 8, self-contained
passages 8, content visibility 7.6, freshness 7, brand/entity trust 6.8, length
6.7, language 6.3, entity consistency 5.8, structured data 5.6, known source 5.4,
domain authority 5, **llms.txt 2**.

_An earlier draft printed 14 of these 23 as a clean table with no note that it was
a subset. The nine dropped included #16 brand/entity trust — which contradicts the
next subsection and is among his best-attested factors, scored by 27 of 54 sources
— and #14 content visibility, which would have supported our own heaviest weight.
Curation by omission, in both directions._

Two scores that look strong and are not: **URL accessibility (9.5)** is close to
a tautology and is his _worst_-attested leader (13 of 54 sources). **Preview
control (9.2)** rests on **exactly one source** — Google's own documentation page.
Both are measuring official support, not measured effect.

### Does classical search rank drive AI citations?

Weakly, and less than it used to. This is where the first draft was most wrong.

Ahrefs, **2 Mar 2026** (863K SERPs, 4M AI Overview URLs): **38%** of AIO
citations come from the top 10 — **down from ~76% in July 2025**. The article
exists to report that collapse. Its own conclusion: _"AI Overviews have shifted,
and ranking for the user's exact query is no longer a guarantee of visibility."_
On blue links only, a cited page is as likely to rank **nowhere in the top 100
(36.7%)** as in the top 10 (37.1%). Ahrefs attributes the shift to fan-out.

Top-10 rank is still ~3.8× enriched over base rate, so it is genuinely
associated. It is neither necessary nor sufficient, and the trend is against it.

_An earlier draft cited "38% from the top 10, rising further beyond the top 10"
as support for rank being the second-strongest signal. That gloss is Shepard's,
not Ahrefs' — it is a cumulative-sum artifact (10 positions hold 38%, the next 90
hold 31%) — and the figure reached us through his summary while being presented as
a direct Ahrefs finding._

**For the pitch:** most of what earns AI citations is the same work that earns
rankings, and Shepard's own summary is _"win SEO, win AI citations (most of the
time, with extra steps)"_. A client already investing in SEO is not starting from
zero, and anyone selling AEO as a wholly separate discipline is overselling. Do
not invert this into "AEO _is_ SEO" — the same evidence puts fan-out above
exact-query rank, and the section below puts the largest predictors off-site.

### Off-site brand signals correlate more strongly than link metrics

Ahrefs, **26 May 2025** — 75,000 brands, **DR>40**, Google **AI Overviews only**.
Spearman correlation with **the count of brand-name mentions inside AI responses**
(measured with Ahrefs' own Brand Radar) — _not_ citations of the brand's website,
which is what our audit scores.

| Signal               | ρ     |
| -------------------- | ----- |
| Branded web mentions | 0.664 |
| Branded anchors      | 0.527 |
| Brand search volume  | 0.392 |
| Domain Rating        | 0.326 |
| Referring domains    | 0.295 |
| Backlinks            | 0.218 |

A **12 Dec 2025** follow-up across ChatGPT + AI Mode + AIO adds YouTube mentions
at **~0.737** — an approximate cross-platform figure over two different question
pools, not comparable row-for-row with the above.

**Do not express these as a multiple.** Correlation coefficients are not on a
ratio scale; "beats backlinks by 3×" becomes 9.3× under variance-explained and
3.6× under Fisher's z. Ahrefs' own characterisation of the whole set: _"moderate
to very weak correlations on the Spearman scale."_

**And do not conclude backlinks are weak.** The sample was filtered to DR>40 —
range restriction on the very variable reported as weakest — and the least-visible
26% of brands were dropped. Every predictor is a proxy for brand size; there are
no controls and no multivariate model, so these cannot be ranked as independent
signals.

_An earlier draft titled this "off-site brand signals beat on-site work",
presented both studies as one table, and claimed "every brand signal beats
backlinks by 2–3×". The study contains **no on-site variables at all**, so it
cannot make that comparison; the table spliced two studies seven months apart on
different platforms; and two of the four ratios fall outside 2–3× anyway._

**Reconciling this with Shepard:** he ranks brand/entity trust 16th of 23 and
link-based domain authority 22nd — apparently the opposite. They measure
different outcomes on different populations (which _page_ gets cited, vs. whether
a _brand_ is mentioned at all among DR>40 brands). Both can be true. Neither
settles the other.

**The ceiling argument, honestly stated.** The conclusion that a site audit
cannot promise a visibility number is right. This table is not what establishes
it. Its sampling frame — DR>40 with a branded keyword above 800 searches/month —
excludes essentially every prospect we have. Use it as directional about _what
kind_ of thing drives visibility, never as a measured ceiling for a small
business.

### A small number of domains take most citations

Reddit, Wikipedia, YouTube, LinkedIn and Forbes plus ten more capture roughly
**68% of citations** across the major engines (AI Platform Citation Source Index
2026, synthesising six studies, 680M+ citations, Aug 2024 – Apr 2026). Treat the
individual percentages as soft — synthesised across studies with different
methods, and the index says rankings shift within weeks. The _shape_ is reliable:
a heavy head of aggregators and UGC, and a long tail where a small business sits.

---

## Contested — do not present as settled

### Does schema markup help?

- **Against (CAUSAL, best design):** Ahrefs tracked **1,885 pages** that added
  JSON-LD between Aug 2025 and Mar 2026 against **4,000 matched controls** (3 per
  treated URL, different domains, similar pre-period citation levels),
  difference-in-differences. Google AI Overviews **−4.6%** ("small but
  statistically significant decline"); AI Mode **+2.4%** and ChatGPT **+2.2%**,
  both "statistically indistinguishable from zero".
- **Ahrefs' own caveat, verbatim:** _"we studied pages that were already being
  cited heavily by AI. Every page in the dataset had 100+ AI Overview citations in
  February 2025, before any schema was added"_ — and they conclude that for pages
  not being seen at all, _"schema markup might still play a role."_ That is the
  situation every one of our prospects is in.
- **Mechanism evidence against:** a searchVIU experiment found that when five
  major AI systems fetched pages in real time, **none used the markup** — they
  extracted visible HTML and ignored JSON-LD, Microdata and RDFa. Google's own
  docs now say there is _"no special schema.org structured data that you need to
  add"_ for AI features, and FAQ rich results were retired in May 2026.
- **For:** Shepard scores it 5.6 and notes _"practically every study that looks at
  schema and AI citations finds a positive relationship. The effect is typically
  small, but it's amazingly consistent."_ Ahrefs explains that consistency as
  adopter characteristics: sites that add schema also invest in technical SEO,
  publish authoritative content, build links and rank well.

**Honest position:** small, consistent, and **confounded** — the consistency is
explained by who adopts it, not established as causal.

**For local businesses specifically:** no study measures LocalBusiness schema
against AI citations. Circulating local figures ("2.7× more likely in the local
pack", "3.2× in AI Overviews") trace to no primary source and must not be used.
The defensible argument is _entity resolution_, not citation lift: Google treats
Google Business Profile as the authoritative local entity and on-site
LocalBusiness/Organization markup corroborates it. That supports scoring **whether
the site's stated identity matches the business's public profiles**, and supports
_not_ scoring **breadth of schema types**.

**Our audit:** schema is **15 of 100 readability points**. Against a confounded
positive, a null causal result, and evidence that engines don't read it at fetch
time, that is too much. Recommend splitting: identity (Organization /
LocalBusiness present and correct) scores; breadth of types does not.

---

## Unsupported — do not recommend

### llms.txt

**The strongest evidence is behavioural, not correlational.** Ahrefs, **15 June
2026**: of **137,210** domains with traffic, checked against server logs —

- **97% of published llms.txt files received zero requests** in May 2026.
- Of the 3% that got any, **77% of the requesting bots aren't AI tools** — SEO
  audit tools 21.7%, unidentified 14.9%, general crawlers 13.1%.
- Named AI bots were **19.5%** of requests, and the split inverts the sales
  pitch: agents 10.5%, training crawlers 5.3%, assistants 2.5%, **retrieval bots
  1.1%**. GPTBot 4.51%, ClaudeBot 0.80%.
- **"Zero AI bots go looking for llms.txt files that don't exist."** Not having
  one costs nothing.
- Ahrefs' own ceiling caveat: _"'fetched' doesn't mean 'read'."_

Corroborating:

- **SE Ranking, ~300,000 domains:** no citation lift; their XGBoost model of
  citation frequency _improved_ when llms.txt was dropped as a variable. Their own
  caveat applies — feature-drop improving held-out accuracy is the expected
  behaviour of a near-zero-signal variable, so this is weak evidence, not a clean
  refutation. _(This and "a 300,000-domain study" are the same study; an earlier
  draft listed them as two independent corroborations.)_
- **Google.** John Mueller, **20 Jan 2026**, asked whether llms.txt on a Google
  domain was an endorsement: _"I'm tempted to say something snarky since this has
  come up so often, but to be direct, no."_ And **June 2026**: _"it's purely
  speculative for now (the file has existed for years, yet none of the AI systems
  use it)."_
- **Shepard ranks it last of 23, score 2** — while conceding _"I'm not certain
  many of these studies even considered the influence of LLMs.txt files."_ It is
  partly absence of evidence; the Ahrefs log study is what supplies the positive
  finding.
- **Adoption estimates disagree:** 2.13% of sites (HTTP Archive Web Almanac
  2025), 10.13% of domains (SE Ranking), 28% of traffic-receiving domains (Ahrefs,
  explicitly "an upper bound"). Of the files the Web Almanac found, **39.6% are
  All in One SEO plugin defaults** and 3.6% Yoast — auto-generated, not authored.
  _(An earlier draft spliced the 39.6% onto SE Ranking's 10.13% base. Different
  studies, incompatible denominators.)_

**The best honest case for it** is upstream: training crawlers fetch it ~5× more
than retrieval bots, so any effect would be on future training corpora, not on
today's citations. Unmeasurable on a client timescale.

**The myth to expect:** vendors claim Anthropic and Perplexity "confirmed
support" in 2026. No such statement exists in either vendor's crawler
documentation. The conflation is that Anthropic, Perplexity and Cloudflare
_publish_ llms.txt for their developer docs — which coding agents consume — and
that is not the same as _reading_ it during retrieval.

**Our audit:** removed from scoring, removed from the model prompt that writes
the fix list, demoted to an explicit footnote in both report surfaces.

---

## Claims that do not survive tracing

Do not repeat these. Two of them were in this document's first draft.

| Claim                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"BrightEdge: +44% AI citations from schema/FAQ markup"**                             | **Does not exist.** BrightEdge's real 44% is that Google's AI Overviews are 44% more likely to criticise brands than ChatGPT. The number was lifted from one claim and attached to another.                                                                                                                                                                                                                                                                                  |
| **"Princeton GEO study: +40% from structured data"**                                   | **Misattributed.** The paper (arXiv 2311.09735, KDD 2024) is real and causal, but its nine tested methods are all **visible-text** edits — it never tested markup. Reuse it correctly: adding statistics (+37%), inline source citations (+40%) and named expert quotations (+22%) is the best-evidenced _content_ intervention in this document.                                                                                                                            |
| "Local businesses with LocalBusiness schema are 2.7×/3.2× more likely to appear"       | Untraceable. Agency blogs citing "a 2025 analysis" that is never named.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **"ChatGPT sources >70% of local results from Foursquare"**                            | **Dead — now factually wrong, not merely unsourced.** Never stated by OpenAI or Foursquare. Traces to one Spanish consultant, May 2025, n=50 prompts across five Spanish cities, measuring **first-place results only**; every scope qualifier was stripped in circulation. The largest current sample (Steady Demand, 2,879 runs, 12 US markets, Aug 2026) measures Foursquare-controlled domains at **0.00%** of citations. The licensing deal is real; the number is not. |
| **"MERJ found 79.2% of Claude's citations in Brave's top 10, replicated by Profound"** | **Attribution inverted.** Profound originated it and MERJ cites them; a July study cannot be replicated by a June one. No independent replication exists, and it has never been published with a method.                                                                                                                                                                                                                                                                     |
| "Vercel analysed 500 million GPTBot fetches and found zero JS execution"               | Mangled. Vercel reported 569M GPTBot **requests in a month**; the rendering finding is a separate, smaller analysis.                                                                                                                                                                                                                                                                                                                                                         |
| "86.7% of Claude's citations rank in Brave's top 10"                                   | n=15 results across 3 queries, one vendor post. The defensible figure is **79.2%** (MERJ, Jul 2026, ~35K citations / 400 queries, replicated by Profound).                                                                                                                                                                                                                                                                                                                   |

---

## What our audit gets right, and what it misses

### Well-supported, keep

| Check                                | Weight             | Evidence                                                 |
| ------------------------------------ | ------------------ | -------------------------------------------------------- |
| JS dependence (raw vs rendered text) | 60/100 readability | Vercel/MERJ — finding supported, weight is our judgement |
| Crawler access, now probed by UA     | 40/100 findability | Measured directly; robots.txt alone gave a false pass    |
| 404 / soft-404 handling              | finding, unscored  | Its own argument, not Vercel's 34%                       |

### Gaps worth closing

1. **Content-level extractability** — the _best-evidenced content intervention in
   this document_ and we measure none of it. The Princeton GEO paper is causal and
   peer-reviewed: statistics +37%, inline source citations +40%, named expert
   quotations +22%. Shepard's #8 (answer near the top, 8.8), #10 (factually
   specific, 8.3), #12 (cites sources, 8) and #13 (self-contained passages, 8) all
   point the same way. We already extract heading trees and full text.
2. **Preview control** — `nosnippet`, `data-nosnippet`, `max-snippet`. Trivially
   checkable from markup we already have. Worth adding on the strength of Google's
   documentation that it suppresses snippets — **not** on Shepard's 9.2, which
   rests on that same single page.
3. **Freshness** — Shepard 7.0, and AI-cited content runs measurably fresher than
   classic organic. We crawl the pages already; a last-substantive-change signal
   is in reach.
4. **Search rank / fan-out rank** — his #2 and #3. Needs a rank-data source, so
   not free. Note the Ahrefs collapse above before weighting it heavily.

### Probably overweighted

- **Schema, 15/100 readability.** See above — split identity from breadth.
- **Viewport, ⅓ of the technical component of findability.** A human-visitor
  factor sitting inside a score about being _found_. It already appears as a
  "Does it work" finding; consider removing it from findability.

### Where local answers actually come from

Checked against primaries, and the answer changed twice while we were looking —
which is itself the most important thing in this section.

- **Gemini is Maps-grounded.** Google documents "Grounding with Google Maps" for
  the Gemini API, over 250M places, returning addresses, hours, reviews. Note the
  scope: it is a developer tool, off by default. Google publishes no equivalent
  statement about the consumer app, so applying it there is inference.
- **ChatGPT's local grounding runs through Yelp, and did not until recently.**
  OpenAI signed a non-exclusive data-licensing deal with **Yelp on 23 July 2026**.
  In the largest current sample (Steady Demand, 2,879 runs, 12 verticals × 12 US
  markets, Aug 2026), Yelp occupies **95.83% of business-card grounding**;
  TripAdvisor leads _cited_ sources at 13.55%; Google is negligible (0.07% cited).
- **The "ChatGPT gets >70% of local results from Foursquare" claim is dead.** See
  the tracing table.

**What this means for us:** for a "near me" query, the engine is assembling an
answer out of place data and review platforms. A website audit does not touch
that. It also means the shelf life of any claim in this paragraph is about a
month — the grounding picture inverted inside four weeks of the Yelp deal. Date
every claim of this kind or do not make it.

### Whether Claude's answers generalise — our engine choice

**Weaker than it looked, and we should stop leaning on it.**

The "Claude's citations track Brave's rankings" thesis rests on **a single
vendor**, Profound, which produced both circulating figures — the launch-day
86.7% (n=15 across 3 commercial queries) and the 79.2% (~35K citations / 400
queries, presented at a conference, **never published with a method**). There is
**no independent replication by anyone**. An earlier draft of this document
credited the 79.2% to MERJ "replicated by Profound"; that is backwards, and
chronologically impossible.

**Anthropic has never confirmed a search provider.** The Brave inference comes
from a subprocessor listing, a `BraveSearchParams` object in the tool schema, and
_Google's_ documentation of Anthropic partner models — not from Anthropic. And
the stack demonstrably changed: Anthropic runs its own crawler
(`Claude-SearchBot`), and a second search subprocessor (**turbopuffer**) was added
in **May 2026** with no public description of its role.

**So:** do not tell a client "Claude runs on Brave, so we will optimise for
Brave." Do name the engine in the report, and treat a single-engine result as
what it is.

### Nobody has measured businesses our clients' size

The three studies this document leans on for the local and branded picture all
sample somebody else:

- **SOCi Local Visibility Index** (28 Jan 2026): ~350,000 locations across 2,751
  brands — an average of **127 locations per brand**. National and regional
  chains. ChatGPT recommends 1.2% of locations vs 35.9% appearing in Google's
  local 3-pack. Method is gated; the prompt set and the definition of
  "recommended" are not published.
- **Omniscient Digital** (8 Jan 2026, 240 prompts → 23,387 citations): on branded
  queries, owned brand content is **23%** of citations, earned media 48%. Sampled
  HubSpot, Salesforce, Chase, Bain — national brands with real editorial
  footprints. **Claude is not among the engines tested.**
- **Profound**: commercial "best X" queries.

**The extrapolation "if chains only get 1.2%, independents get less" is intuitive
and completely unmeasured.** A chain has national press and Wikipedia entries a
local dentist does not; it also has 127 locations competing for one slot. The
direction of the error is genuinely unknown. Do not present it as data.

### Whether any of this converts

AI referral traffic is on the order of 1% of sessions, and professional services
shows the lowest citation rate of any measured segment. The defensible value is
credibility and factual correctness, not traffic. **The report must never imply a
traffic lift.**

---

## How accurate are AI answers about a business?

The mechanism is one of the better-replicated findings in the LLM factuality
literature. The number everyone quotes for it is an arithmetic artifact sold by
a vendor. Both halves matter.

### The mechanism is real — cite the academics, never the vendor

Accuracy falls as an entity's footprint on the web shrinks. Independently
established, replicated, with large effects:

- **Mallen et al., ACL 2023 (PopQA)** — accuracy tracks entity popularity across
  nearly all relation types; scaling helps only popular entities.
- **Kandpal et al., ICML 2023** — TriviaQA accuracy rises 25% → >55% as relevant
  pretraining documents go from 10¹ to 10⁴. Correlational _and_ causal.
- **Min et al., EMNLP 2023 (FActScore)** — ChatGPT atomic-fact precision falls
  **80% → 16%** from frequent to very-rare entities.
- **Sun et al., NAACL 2024 (Head-to-Tail)** — monotonic head → torso → tail
  decline. GPT-4: 30.9% accurate, 19.7% hallucinated, **~49% missing**.
- **Zhao et al., COLM 2024 (WildHallucinations)** — 52% of entities real users
  ask about have no Wikipedia page, and models hallucinate more on those. The
  closest published analogue to "small business".
- **Kalai et al. (OpenAI), 2025** — hallucination rate is lower-bounded by the
  singleton rate. Rare-fact error is provably hard.

### The "93% of small businesses" figure is 9% restated

Reported as: 13,000+ prompts, three engines, London companies graded against
Companies House; 93% with at least one wrong or missing fact; 50% of SMEs with a
fabricated fact vs 32% of large firms.

**Do not use it.**

- **The source is an AEO vendor** — Searchable, $14M seed at an $85M valuation,
  selling subscriptions at $125–400/month to fix the problem it measured. Its
  entire 163-URL sitemap contains no report for this study: no methodology, no
  data, no prompt set, no model versions, no n per group. It is a syndicated
  press release, re-cut regionally (London, UK high street, Birmingham, Leeds)
  across a dozen outlets that reuse identical phrasing.
- **The headline is arithmetic.** 13,365 prompts ÷ 3 engines ÷ 165 companies =
  exactly **27 facts per company per engine**. At the vendor's own published
  fact-level error rate of 9.2%: `1 − 0.908²⁷ = 92.6%`. "At least one error per
  entity" is a function of how many facts you probe, not of model quality — 3
  probes gives 25%, 20 gives 85%, 50 gives 99%. The number is manufacturable to
  order, and anyone who does the division reproduces it in one line.
- **Their own methodology-bearing report says something else**: 75% (not 93%),
  9.4% vs 6.3% at fact level (not 50% vs 32%), "large" defined as 250+ (not
  500+). It also explicitly reserves the word _hallucination_ for fabrications,
  as against "outdated but once-true" and "mistaken identity" — the exact
  distinction the press release collapses.
- **Two findings cut against the pitch.** Retrieval helps _most_ on small
  entities (Mallen), and all the tested products browse by default. And large
  companies are not fine either — Head-to-Tail puts GPT-4 at 46–48% on the _most_
  popular entities.
- **Error rates are falling fast.** GPT-5 claim-level hallucination is ~26% below
  GPT-4o; Gemini went 55.6% → 72.1% on SimpleQA Verified inside a year. A July
  2026 snapshot has a short half-life.

### And nobody has measured US local businesses at all

OpenAlex and Semantic Scholar sweeps return **zero peer-reviewed studies**
measuring AI accuracy on individual business facts. The entire commercial
evidence base is vendor marketing.

The UK study does not port, for four structural reasons:

- **There is no US ground truth.** Companies House is one free national register.
  The US has 51 fragmented state registers, FinCEN BOI exempted domestic entities
  in March 2025, and **29.8M nonemployer businesses (~68% sole proprietors
  without an EIN) appear in no register at all.** For a solo dentist, "founding
  year" and "employee count" are not merely irrelevant — they are not gradeable.
- **Different retrieval path.** Those were company-research questions. A US local
  query fires place grounding: Yelp for ChatGPT, Maps for Gemini. SOCi measures
  profile accuracy there at **68% / 68% / 100%** — not 7%.
- **The fact mix inverts.** Of the five weak fields, two transfer (phone,
  services), two are unverifiable for a sole proprietor. The high-stakes US local
  fields — hours, insurance accepted, licence status, accepting new patients —
  were never tested.
- **The one US datapoint** is Seer Interactive (n=178 branded queries, 7 models,
  Dec 2025): a phone number was supplied 91% of the time, matched the brand's own
  site 64%, and **matched their Google Business Profile only 27%**. National
  brands, not small businesses.

**What is defensible to say, and it is enough:** independent academic research
consistently finds AI gets facts wrong more often for businesses with a smaller
online footprint; industry testing puts roughly one stated fact in eleven wrong;
**nobody has measured this properly for US local businesses — so we measure
yours.** That claim survives someone checking our homework. The 93% does not.

---

## What we measured ourselves

Not a study — nine hand-picked prospects, one engine, one window, adjudicated by
reading. A pilot that tells us what to build. It is here because it converged
with the literature from a completely different direction — and because, per the
section above, there is no published measurement of this for businesses like our
clients', which makes even a nine-site pilot the best data anyone has offered us.

For each of nine audited businesses we took the stored branded answers and
checked every factual assertion against that business's own crawled text.

| Site                             | Outcome                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Beachfront Dentistry             | Engine named "Drs. Michael Hopkins, Barbara Kane, Jon Monette". The practice's own `/our-team` page lists **Hopkins and Quan**. Kane and Monette are real and appear across WebMD, Zocdoc, Healthgrades, Yelp and patientconnect365 in identical boilerplate — **stale directory roster, and Dr. Quan omitted entirely** |
| Reddoor Creative (us)            | **Misidentified** — engine's "most prominent" match is a Virginia photography company. "Virginia", "Hampton Roads", "Portsmouth" appear nowhere on our site                                                                                                                                                              |
| Caltex Medical                   | **Unresolved** — "there isn't one single Caltex Medical"                                                                                                                                                                                                                                                                 |
| Revogen                          | **Unresolved** — engine offered _Revivogen_, a hair-loss shampoo, and asked which was meant                                                                                                                                                                                                                              |
| Icovy                            | 3 of 4 asserted locations on site; "Tucson" is not                                                                                                                                                                                                                                                                       |
| Ludlow Kingsley                  | "over the past 15 years" — absent from the site                                                                                                                                                                                                                                                                          |
| Espada / ParkerWhite / Designity | Accurate                                                                                                                                                                                                                                                                                                                 |

**The failure mode is identity, not hallucination.** Nothing was invented. Four
of nine could not be correctly resolved or described, and the mechanism is the
one the literature describes: the engine assembles the business from third-party
profiles, and where the site is silent, thin or ambiguous, the profiles win. The
Beachfront case is the mechanism made concrete — Yelp is 95.83% of ChatGPT's
business-card grounding, and Yelp carries the stale roster.

**This is the product.** Not "we will raise your visibility" — three independent
lines of evidence now say we cannot. Instead: _is what an AI tells people about
you actually true, and where did it get it?_ Extract the assertions from a
branded answer, diff them against the client's own site, and sort into
site-confirms / **site-contradicts** / site-never-says-it-so-someone-else-is-the-
source. Every part is buildable from data the audit already collects, it has a
before and an after, and the remedy is real work: state your team, locations and
services unambiguously, and fix the directories currently speaking for you.

---

## Why our own data is not in here

`prospect_audits` holds 13 rows over **9 distinct sites**, four of them repeat
runs of reddoorla.com, in a two-day window, against a **single engine** (Claude —
Perplexity has never run). Every site was hand-picked as a prospect.

That is a convenience sample. Useful for _checking_ a claim from this document
against sites we know — it is how the ladder hypothesis got killed and how the
ClaudeBot block was found. It is not evidence, it cannot support "all N" or
"universal", and its aggregate counts are contaminated by the repeats. Keep it
out of anything a client reads.

---

## Sources

**Peer-reviewed — the only sources here that are not commercial.** These carry
the entity-popularity finding, and they should be what we cite for it:

- Mallen et al., [When Not to Trust Language Models (PopQA)](https://arxiv.org/abs/2212.10511) — ACL 2023
- Kandpal et al., [Large Language Models Struggle to Learn Long-Tail Knowledge](https://arxiv.org/abs/2211.08411) — ICML 2023
- Min et al., [FActScore](https://arxiv.org/abs/2305.14251) — EMNLP 2023
- Sun et al., [Head-to-Tail](https://arxiv.org/abs/2308.10168) — NAACL 2024
- Zhao et al., [WildHallucinations](https://arxiv.org/abs/2407.17468) — COLM 2024
- Kalai et al. (OpenAI), [Why Language Models Hallucinate](https://arxiv.org/abs/2509.04664) — 2025

**Commercial, read directly:**

- Vercel + MERJ, [The rise of the AI crawler](https://vercel.com/blog/the-rise-of-the-ai-crawler) — 17 Dec 2024
- Ahrefs, [We Analyzed 137K Sites: 97% of llms.txt Files Never Get Read](https://ahrefs.com/blog/llmstxt-study/) — 15 Jun 2026
- Ahrefs, [We Tracked 1,885 Pages Adding Schema](https://ahrefs.com/blog/schema-ai-citations/) — 2026, causal, matched controls
- Ahrefs, [38% of AI Overview Citations Pull From The Top 10](https://ahrefs.com/blog/ai-overview-citations-top-10/) — 2 Mar 2026
- Ahrefs, [An Analysis of AI Overview Brand Visibility Factors](https://ahrefs.com/blog/ai-overview-brand-correlation/) — 26 May 2025
- Ahrefs, [Top Brand Visibility Factors in ChatGPT, AI Mode, and AI Overviews](https://ahrefs.com/blog/ai-brand-visibility-correlations) — 12 Dec 2025
- SE Ranking, [Does LLMs.txt impact your AI visibility and citations?](https://seranking.com/blog/llms-txt/) — ~300K domains
- Cyrus Shepard / Zyppy, [AI Citation Ranking Factors Analysis](https://signal.zyppy.com/p/ai-citation-ranking-factors) + [his scoring sheet](https://docs.google.com/spreadsheets/d/1LdIp1_34yeHM6M0m4Y4LoxM2_j-Q6QXmkiwGGUc-NGg/) — May 2026
- [HTTP Archive Web Almanac 2025, SEO chapter](https://almanac.httparchive.org/en/2025/seo)
- Google, [crawlers and user agents](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers) · Apple, [Applebot](https://support.apple.com/en-us/119829) · [OpenAI bots](https://developers.openai.com/api/docs/bots) · [Anthropic crawlers](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) · [Perplexity bots](https://docs.perplexity.ai/guides/bots)
- Daniel Cheung, [schema → AI citations: an evidence review](https://www.danielkcheung.com/musings/schema-ai-citations-evidence-review) — the systematic review that traced the phantom statistics
- Search Engine Roundtable, [Google does not endorse llms.txt](https://www.seroundtable.com/google-does-not-endorse-llms-txt-40789.html) — 20 Jan 2026

**Reached us through summaries — treat as unverified until read:** the AI
Platform Citation Source Index 2026, the searchVIU schema-fetch experiment, the
MERJ Claude/Brave figure and every
local-search sourcing claim.
