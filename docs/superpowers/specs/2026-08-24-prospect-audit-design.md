# Prospect Audit — Design

**Date:** 2026-08-24 · **Status:** approved (Tucker, in-session) · **Repo:** reddoor-maintenance

## What and why

A CLI-triggered AEO/SEO audit of an **external prospect's website**, producing a
Reddoor-branded report at a shareable hosted link. Sales-stage tooling: Tim's
"Can AI and Google actually find you?" outreach (Discord, 2026-08-24) promises a
three-step audit; this tool is that audit, and the outreach email's three
bullets map 1:1 onto the report's structure. Greenlit by Tim 2026-08-24
("yes! I saw that in the 'what we need' before we execute").

Distinct from the fleet audits: prospects have no repo, no Airtable Websites
row, no Netlify site. This is a **new module** (`src/prospect/`), not new
entries in the fleet `REGISTRY` — the fleet's Site semantics (checkouts, dev
servers, write-backs, dashboards) must not have to special-case URL-only
strangers. It reuses the platform's utilities (Lighthouse runner,
security-header logic, spawn, Turso, the Netlify site) rather than its fleet
orchestration.

## Decisions (made with Tucker, 2026-08-24)

| Question | Decision |
|---|---|
| Trigger | CLI, run by Tucker/Tim (`maintenance prospect-audit <url>`); auto-on-inquiry and self-serve lead magnet are explicit non-goals for v1 |
| Deliverable | Hosted shareable report link (public tokened route on the maintenance Netlify site) |
| Depth | All three tiers in v1: deterministic checks + Claude answerability pass + live AI-visibility probes |
| Placement | New `src/prospect/` module in reddoor-maintenance |

## Pipeline

Five stages behind one orchestrator. Every stage returns `{ok, data | error}`;
a failed stage degrades its report section to "not measured" and never kills
the run. Stage order matters only where data flows (probes consume analyze's
query set).

### 1. `crawl.ts`

- Fetch `robots.txt` and evaluate an **AI-crawler access matrix**: GPTBot,
  OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, plus
  Googlebot/Bingbot as the classical baseline.
- Fetch `sitemap.xml` (presence, parse, URL count) and `llms.txt` (presence,
  shape).
- Discover key pages: sitemap URLs ∪ nav links from the home page, capped at
  ~20, same-origin only, polite (sequential with delay, honest custom UA
  naming Reddoor). We are auditing on the prospect's behalf; the crawl is
  small and identified, and robots.txt disallow rules for generic agents are
  respected for page fetches (the audit *reports* AI-agent blocks; it does not
  bypass them).
- Per page, capture **both** the raw HTTP HTML and the Playwright-rendered
  DOM. Extract from each: text content, meta title/description, OG/Twitter
  tags, canonical, heading tree, JSON-LD blocks, image alt coverage.
- The raw-vs-rendered visible-text delta is the **JS-dependence score** — most
  AI crawlers do not execute JavaScript, so a large delta means the site is
  effectively invisible to them. This is the headline mechanical finding.

### 2. `checks.ts`

Pure functions over the crawl output (no network — fixture-testable):

- Crawler access scoring from the robots matrix.
- Schema inventory: JSON-LD types found vs expected for a business site
  (Organization, LocalBusiness/Service, FAQPage, Article/BlogPosting),
  syntax-valid JSON.
- Meta/OG completeness per page; canonical presence/self-consistency.
- Heading hierarchy sanity (one h1, no level skips) and answer-first
  structure signals (section openers that could stand alone).
- llms.txt / sitemap presence; mobile viewport meta.
- Security headers (reuse the fleet security audit's header logic against the
  live response).
- Lighthouse perf/SEO/best-practices/a11y via the existing runner pointed at
  the live URL (the fleet lighthouse audit already supports `deployedUrl`-style
  direct-URL runs; extract/reuse that path).

### 3. `analyze.ts` — the Claude answerability pass

One `claude-opus-5` call (adaptive thinking; structured output via
`output_config.format`; streaming). Input: the rendered text + heading trees of
the crawled pages (bounded) plus the deterministic findings. Output schema:

- `business`: what this company does, for whom, where (the model's read —
  which is itself a diagnostic: if Claude can't tell, neither can the engines).
- `entityClarity`: score + what's missing (name/place/offer ambiguity).
- `buyerQuestions[]` (6–10): the questions this site should answer; per
  question `{question, answered: yes|partial|no, quotable: bool, page,
  evidence}`.
- `fixes[]`: prioritized `{title, why, impact, effort, tier}` list.
- `narrative`: short report-facing prose per section.

Cost ≈ $0.50/audit at Opus 5 rates. The Anthropic client resolves credentials
through the standard chain (`ANTHROPIC_API_KEY` → auth profile).

### 4. `probes.ts` — live AI-visibility

- Query set: from `analyze` output (branded: "who is X", "X reviews";
  category: "best [category] in [city/vertical]", the buyer questions
  themselves), ~5–8 queries. `--competitors` seeds extra comparison queries.
- Engine adapters behind one `VisibilityEngine` interface:
  - **Perplexity Sonar** (`sonar`, citations included, ~$1/Mtok) — needs new
    `PERPLEXITY_API_KEY`.
  - **Claude + web_search** (`web_search_20260209` server tool on
    `claude-opus-5`).
  - OpenAI/Gemini adapters are v1.1+ — the interface is the extension point.
- Per query per engine, record: prospect domain cited? brand mentioned? who
  *was* cited/recommended (the competitor receipts). Aggregate to an **AI
  Visibility score** + the "what the engines said about you" section.
- Cost ≈ $0.10/audit.

### 5. `persist.ts` + `render.ts` + surfaces

- **Turso** table `prospect_audits`: `id`, `token` (unguessable, 128-bit),
  `url`, `business`, `created_at`, `status`, `result_json` (full pipeline
  output). Follows the db module's existing conventions (`src/db/`).
- **`render.ts`**: one renderer, JSON → self-contained branded HTML (Besley +
  brand red, consistent with the site's OG-card look; print-to-PDF clean;
  `noindex`). Used by both surfaces below so the file and the link never
  drift.
- **CLI**: `maintenance prospect-audit <url> [--business "Name"]
  [--competitors a.com,b.com] [--no-probes] [--out report.html]` — runs the
  pipeline with listr2 progress (matching the audit CLI's feel), prints the
  terminal summary + the shareable link.
- **Hosted route**: public `GET /r/{token}` on the existing maintenance
  Netlify site, **outside** the dashboard's basic-auth, `X-Robots-Tag:
  noindex`, rendered from Turso. Domain: works immediately at the
  netlify.app URL; alias `audit.reddoorla.com` once the DNS record + Netlify
  domain alias are added (a deploy-time task, not code).

## Report shape

Scorecard header (four scores: **Findability** — crawler access + technical;
**Readability** — JS-dependence + structure; **Answers** — answerability
coverage; **AI Visibility** — probe results) → "What the AI engines said about
you" (probe receipts — the hook) → per-tier findings → prioritized fix list →
Reddoor CTA. Maps to the outreach email's three bullets: crawl & visibility
check / answer coverage / prioritized fix list.

## Error handling

- Stage isolation as above; the report renders whatever succeeded.
- Per-page fetch timeouts; a page failure drops the page, not the crawl.
- Unreachable site / DNS failure: the CLI fails fast with a clear message —
  no report is persisted.
- Probe/API failures (429s, key missing): section renders "not measured",
  CLI notes why. `--no-probes` skips tier 3 deliberately.

## Testing

- Vitest colocated per module (repo convention).
- `checks.ts` against HTML fixtures — the bulk of coverage, no network.
- `analyze.ts`/`probes.ts` against stubbed clients (URL-routed fetch stubs,
  same pattern as reddoor-website's `ghl/client.test.ts`).
- `render.ts` snapshot-ish assertions on section presence/degradation.
- One orchestrator test: full pipeline over fixtures with LLM/probe stages
  stubbed, asserting the persisted JSON shape and the degraded-section paths.
- CI runs no live-network or paid-API calls.

## New environment

| Var | Where | Purpose |
|---|---|---|
| `PERPLEXITY_API_KEY` | maintenance .env + Netlify env | Sonar probes |
| (existing) Anthropic auth | already resolves | analyze + Claude probe |
| (existing) Turso vars | already present | persistence |

## Non-goals (v1)

- Auto-audit on inquiry submission; self-serve public lead-magnet page.
- Rank tracking over time / scheduled re-audits (one-shot snapshots only).
- OpenAI/Gemini probe adapters (interface reserved).
- PDF generation (the HTML prints clean; that is enough).
- Any write into the fleet audit registry, Airtable, or fleet dashboards.

## Open items (deploy-time, not design)

- Create the Perplexity API account/key.
- DNS: `audit.reddoorla.com` CNAME + Netlify domain alias.
