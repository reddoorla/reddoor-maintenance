# Checklist Auto-Tick — Design

**Status:** Approved design, ready for implementation planning.
**Branch:** feature branch, not gated on 1.0.
**Date:** 2026-06-18.

## Goal

The report pipeline gates every Maintenance/Testing report behind a 13-item operator
checklist (6 Maintenance + 7 Testing). Each item is a manual Airtable checkbox the operator
ticks before a report can be approved/sent. This design makes the system **verify and
auto-tick the checks it can prove**, removing operator busywork while keeping a human signing
off on every report.

## Context: which of the 13 are automatable

A per-check analysis (with an adversarial pass over every "automatable" verdict, hunting for
false-greens) produced this tiering. The driving insight: **a green checkbox is a
client-facing assertion** — when ticked, the email tells the recipient we verified it — so an
auto-tick must rest on _proof_, not mere correlation.

| Check                     | Report | Tier                  | Signal                                                         |
| ------------------------- | ------ | --------------------- | -------------------------------------------------------------- |
| Google Indexed            | Maint  | **auto (this slice)** | Search Console `foundOnPage1` (already fetched at draft)       |
| Security Updates          | Maint  | **auto (this slice)** | security audit vuln counts (exists) + new freshness field      |
| Domain, DNS & SSL         | Maint  | **auto (this slice)** | new `checkDomain` (Node `dns`+`tls`)                           |
| Desktop Browsers          | Test   | **auto (this slice)** | new deployed-URL Playwright harness                            |
| Mobile Browsers           | Test   | **auto (this slice)** | new deployed-URL Playwright harness                            |
| Links & Navigation        | Test   | **auto (this slice)** | new deployed-URL Playwright harness                            |
| Form Functionality        | Test   | deferred              | synthetic submit — needs a Submissions delivery webhook first  |
| Page Titles & Meta        | Test   | deferred              | multi-page crawl — fast-follow on the harness                  |
| Deploy & Function Health  | Maint  | keep manual           | deploy-half overlaps the harness; function-half overlaps Forms |
| Uptime Checked            | Maint  | keep manual           | no continuous monitor exists                                   |
| CMS Checked               | Maint  | keep manual           | no per-site CMS identity exists                                |
| Interactions & Animations | Test   | keep manual           | visual judgment; a11y audit disables animations                |
| Tested After Updates      | Test   | keep manual           | no "tested _after_ the change" temporal signal                 |

**This slice automates the 6 "auto" rows.**

## Automation model (decided)

**Auto-tick where confident**, governed by a non-negotiable invariant:

> **Fail-safe:** a box auto-ticks only on _fresh positive proof_. Missing signal, stale
> signal, failing signal, or a soft-failed enrichment all resolve to **unticked** (rendered
> amber with the reason). The system never asserts a check it cannot currently prove.

Three more rails:

- **Evidenced:** every auto-tick records a short evidence note shown at the approve step
  ("cert 73d · custom domain · resolved <2d ago").
- **Overridable:** the operator can untick any box (the existing one-click toggle); an
  edited box simply diverges from its badge.
- **Gated:** the existing per-report human approve step is unchanged. Auto-tick removes
  per-box busywork; it does not remove the human sign-off on the report as a whole.

## Architecture

Auto-tick reuses the proven path that Lighthouse scores already travel
(audit → Websites row → `draftReportForSite` reads it → Reports row):

```
nightly audit sweeps  →  Websites row (per-signal result + checked-at + evidence note)
                                              │
inline-at-draft signals (Search/GA)  ─────────┤
                                              ▼
                              draftReportForSite → autoTickChecklist(...)
                                              │
                  (a) sets Reports Maint:/Test: booleans  → dashboard renders ✓ (existing path)
                  (b) writes Reports `Checklist auto-evidence` JSON → dashboard renders badge/amber (new)
                                              ▼
                  approve view: ✓ / amber + evidence; operator may untick; approve gate unchanged
```

There are **two evidence sources**:

1. **Inline-at-draft** — Search Console / GA are already fetched inside `draftReportForSite`;
   the search result feeds Google Indexed directly (no nightly audit, inherently fresh).
2. **Nightly-audit → Websites row** — Security, Domain, and the browser signals are written
   by nightly sweeps and read from the Websites row at draft time, gated on freshness.

### Why this placement (vs. alternatives)

- **Chosen:** audit → Websites evidence → auto-tick at draft. Mirrors the existing
  scores/GA/Search flow; built-in audit trail; override-friendly; no ordering problem.
- Rejected: audits writing the Reports row directly (the draft doesn't exist at audit time).
- Rejected: recompute live at approve-render time (no snapshot/trail; recomputes every load).
  The report is a point-in-time snapshot, so snapshot-at-draft is the correct semantics.

## Components

### 1. Evidence model + Airtable fields

A per-check evidence record: `{ result: "pass" | "fail" | "unknown", checkedAt: ISO string, note: string }`.

**Websites row — new fields** (written by the nightly audits):

- `Last security audit at` (freshness for the existing security vuln counts).
- `Domain checked at`, `Cert days remaining` (Domain/DNS/SSL).
- `Crossbrowser OK` (Desktop), `Mobile OK` (Mobile), `Links OK` + `Broken links` (Links & Nav),
  and ONE shared `Browser checked at` timestamp gating all three (they're produced by one
  `browser` audit run, so a single freshness field is honest and avoids three always-equal
  columns — implemented this way rather than the per-check timestamps sketched earlier).

**Reports row — new field** (written at draft time):

- `Checklist auto-evidence` — one JSON blob keyed by checklist `field`, each value an
  evidence record. Snapshots the auto-tick rationale with the report (frozen, consistent
  with the boolean and what gets sent). One field rather than ~13 columns.

The 13 boolean `Maint:/Test:` columns are unchanged — auto-tick writes the same booleans the
operator and the dashboard already use.

### 2. `autoTickChecklist` (pure)

`autoTickChecklist(site: WebsiteRow, reportType: ReportType, now: Date, draftSignals): Map<field, EvidenceRecord>`

- Input: the Websites row evidence fields + the inline draft signals (search presence).
- Output: per checklist `field` for this report type, an evidence record. `result: "pass"`
  **and** fresh → the caller ticks the box; anything else → no tick.
- Freshness: a result is fresh when its `checkedAt` is within the staleness window
  (reuse the `GITHUB_SIGNALS_STALE_DAYS` ~3-day convention). A stale `pass` degrades to
  `unknown`. Google Indexed is inline → always fresh.
- PURE and exhaustively unit-tested; it is the single place the fail-safe invariant lives.

### 3. `draftReportForSite` integration

After computing scores/enrichment, call `autoTickChecklist`. For each returned `pass`+fresh
entry, set the Reports boolean `true`; write the full evidence map to `Checklist
auto-evidence`. Leaves every other box untouched (operator handles those, exactly as today).
Already-manual reports and report types without a checklist (Launch/Announcement) are
unaffected.

### 4. Dashboard checklist rendering (Section 1b)

`checklistBlock` (src/dashboard/render.ts) is augmented to render three states per item,
reading the Reports row boolean + `Checklist auto-evidence`:

- **✓ auto** (green) — auto-ticked, evidence note inline/tooltip.
- **🟡 amber** — signal ran but isn't green (fail or stale): box unticked, reason shown; the
  operator ticks manually if satisfied.
- **plain** — manual-only check (no evidence), exactly as today.

The toggle endpoint (`setReportChecklistItem`) and the approve gate are unchanged.

## The signals

### Google Indexed (inline)

- **Source:** `fetchSearch` (already in `draftReportForSite`) → `{ foundOnPage1, position }`;
  `pickBrandQuery` selects the highest-impression matching row (phrasing-robust).
- **Pass bar:** `foundOnPage1 === true` AND `softFailed === false`.
- **Honest scope:** ties the tick to the _same_ value the email prints as "Page 1 (#N)", so
  tick and number cannot disagree.

### Security Updates (existing signal + freshness)

- **Source:** nightly security audit → `Security Vulns Critical/High/...` on the Websites row.
- **Pass bar:** `securityVulnsCritical === 0 && securityVulnsHigh === 0`, fresh
  (via the new `Last security audit at`). Moderate/low are advisory, not gating.
- **Honest scope:** "no known critical/high advisories in declared dependencies as of the
  last audit." Does not prove the fix is deployed.

### Domain, DNS & SSL (new `checkDomain`, Node builtins only)

- **Source:** `src/audits/domain.ts` → `checkDomain(url)`: `dns.promises.lookup` (resolves),
  `node:tls` cert (`valid_to` > 14 days, SAN matches host), `!isNetlifyAppUrl(url)`.
- **Pass bar:** resolves AND cert valid & >14 days to expiry AND custom domain.
- **Honest scope:** domain-resolves + valid-unexpired-cert. Does NOT claim registrar-expiry,
  www↔apex redirect, or MX (an auto-renewing cert can stay green while registration lapses).

### Desktop / Mobile / Links & Nav (new deployed-URL Playwright harness)

One checkout-free audit, `src/audits/browser.ts`, crawls the live site once (needs only
`deployedUrl`, like Lighthouse deployed mode) and yields all three signals.

**Route discovery (representative sample, incl. CMS-generated pages):** fetch
`<deployedUrl>/sitemap.xml`, then **bucket URLs by path family** (first path segment / template
shape — e.g. `/`, `/about`, `/work/*`, `/blog/*`) and **sample from each bucket**, so every
page _type_ is covered rather than the first N entries (which skew to top-level static pages).
This guarantees the dynamic, CMS-generated templates — Prismic `[uid]`/`[slug]` detail pages
(blog posts, projects, portfolio items) — are represented, which is exactly where a broken
image, an overflowing gallery, or a dead CMS link hides. Cap ~15–20 routes total, distributed
across buckets: always include `/`, then at least one page per family up to the cap (sampling
more from larger families). Fallback if no sitemap: homepage + same-origin internal links found
on it (one level). Worst case: homepage only. The sampled routes + per-family counts are
recorded in the evidence note ("12 routes across 4 families: /, /work ×4, /blog ×4, /about ×3"),
so the operator can see CMS coverage at a glance.

| Signal             | Pass bar                                                                                      | Honest scope                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Desktop Browsers   | chromium+firefox+webkit load every route, 0 uncaught JS errors, main landmark visible         | renders without errors cross-engine; a CSS-only visual break with no error escapes (visual polish stays manual) |
| Mobile Browsers    | iPhone(WebKit)+Pixel(Chromium): 0 horizontal overflow (`scrollWidth ≤ viewport`), 0 JS errors | catches overflow + errors; does not prove real-device touch handlers                                            |
| Links & Navigation | 0 broken internal links (200 + soft-404 heuristic) + primary-nav click reaches expected URL   | internal links high-trust; external links advisory-only                                                         |

**Fail-safe under flakiness:** deployed-URL runs wobble (same as deployed Lighthouse running
3×). Per-route Playwright retries; a _run error_ (network/timeout) → `unknown` (box stays
manual), never `fail`. A genuine assertion failure → `fail` + evidence shows what broke.

## Nightly sweeps

A nightly workflow (sibling of fleet-lighthouse) runs the Domain and Browser audits over
maintenance + launch sites that have a `deployedUrl`, with per-site isolation (skip + warn,
never crash — the `prepareFleetSites` resilience lesson), writing each signal's result +
checked-at + evidence to the Websites row. Security/deps already have a nightly sweep; it
gains the `Last security audit at` write.

**Infra:** the runner must `playwright install` firefox + webkit (chromium is already used by
the a11y audit).

## Testing strategy

- `autoTickChecklist` — table-driven per check: pass-bar met → tick; fail/stale/missing/
  soft-fail → no tick. The fail-safe invariant (stale-green never ticks) gets its own test.
- `checkDomain` — mocked `dns`/`tls`: valid, <14-day, expired, `*.netlify.app`, unresolvable.
- Browser audit — unit-test the pure parts (sitemap parse, assertion → result mapping) with
  fixtures; integration-test the Playwright run against one known-good and one known-broken
  fixture page (the a11y-fixtures pattern). Don't re-test Playwright itself.
- `checklistBlock` render — the three states (auto-green / amber / manual).
- `draftReportForSite` — booleans + evidence JSON written when fresh/green; untouched otherwise.

## Rollout phasing (each independently shippable; fail-safe ⇒ partial rollout never regresses)

1. Engine (`autoTickChecklist` + evidence JSON) + dashboard rendering + **Google Indexed**.
2. **Security Updates** (+ `Last security audit at`) + **Domain/DNS/SSL** audit + sweep.
3. **Browser harness** (Desktop/Mobile/Links) + sweep + `playwright install` infra.

## Non-goals / deferred

- **Form Functionality** — gated on first wiring a Resend _delivery_ webhook into Submissions
  `notifyStatus` (today "sent" = API-accepted only). Then a synthetic-submit audit.
- **Page Titles & Meta** — fast-follow reusing the harness route discovery; mechanical crawl
  (presence/uniqueness/placeholder), not editorial accuracy.
- **Deploy & Function Health** — revisit once Forms exists; stays manual.
- **Keep manual:** Uptime (needs a monitoring service), CMS (needs a per-site CMS-identity
  schema), Interactions & Animations (visual judgment), Tested After Updates (no temporal
  "after the change" signal).

## Risks

- **False-green via correlated-not-causal signals** — mitigated by the fail-safe invariant +
  honest per-check scope + the unchanged human approve gate + visible evidence.
- **Deployed-URL flakiness** — mitigated by retries + run-error→`unknown` (never false-fail).
- **Evidence/box divergence after draft** — intentional: the report is a snapshot; an operator
  override simply diverges from its badge, which is informative, not a bug.
