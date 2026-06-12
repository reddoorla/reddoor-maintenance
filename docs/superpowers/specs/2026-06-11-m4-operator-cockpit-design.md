# M4 — Operator cockpit: the fleet homepage as a triage surface (design)

**Date:** 2026-06-11
**Status:** Design — approved at the architecture level (Tucker, 2026-06-11). Ready for an implementation plan.
**Milestone:** M4 of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md) (§M4). Builds on M3's approve loop ([M3 design](2026-06-11-m3-scheduled-recurrence-design.md)) and reuses the M5 alert collectors ([M5 design](2026-06-11-m5-alerting-design.md)).

> Goal: turn the fleet homepage (`/`) from a flat alphabetical card list into a **triage cockpit** — the surface Tucker opens each morning — that surfaces what's broken across ~200 sites, ranked, without burying it under the healthy majority, while keeping the one daily action (approve) one click away.

---

## 1. The reframe: read-and-act surface → triage cockpit

The homepage today ([netlify/functions/fleet-homepage.mts](../../../netlify/functions/fleet-homepage.mts) → [renderFleetHomeHtml](../../../src/dashboard/fleet-render.ts)) renders every `dashboardToken`-opted-in site as a flat, alphabetically-sorted card with its Lighthouse / a11y / deps / sec metrics, plus an M3 "N pending your yes" banner. It reads-and-acts but doesn't **triage**: at 200 sites a single critical vuln is one indistinguishable card in a 200-card scroll.

M4 reframes the page around the operator's morning question — **"what's broken, and what needs my yes?"** — by grouping sites into health tiers, surfacing the live alert signals on each card, and pinning the approve queue at the top.

A key enabler already exists: the M5 collectors ([src/alerts/digest-collectors.ts](../../../src/alerts/digest-collectors.ts)) are **pure functions over already-fetched Airtable rows** returning a typed `AttentionItem[]`. The cockpit reuses them verbatim, so the screen and the daily email can't disagree about what counts as a problem.

## 2. Decisions locked in this brainstorm (2026-06-11)

| Fork                        | Decision                                                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core layout**             | **Per-site cards** (keep today's warmer card style), not a dense sortable table.                                                                                                                                                                                            |
| **Organizing 200 cards**    | **Health tiers** — three collapsible sections: 🔴 Needs attention (expanded), 🟡 Watch (collapsed), 🟢 Healthy (collapsed). The broken sites surface; the healthy ~190 fold away.                                                                                           |
| **Approve queue placement** | **Pinned at the top**, above triage — approving is the daily action, triage is the scan. Reuses the M3 one-click approve endpoint untouched.                                                                                                                                |
| **Signal set**              | Reuse the M5 alert signals: **vulns, delivery, Lighthouse<75** (Airtable-resident → slice 1); **Renovate-failing CI, CI-red, last-deploy staleness** (GitHub-sourced → slice 2). Pending-approval is orthogonal (an action, not a health tier).                             |
| **Render path**             | **Read-from-Airtable only; no live GitHub/Lighthouse calls in the request path.** Everything on screen is already-persisted state, so the page is fast at 200 rows. Slice 2's GitHub signals are persisted to Airtable by the nightly cron, then read like everything else. |
| **NEW/WORSE badges**        | The cockpit reads the "Digest State" snapshot **read-only** to badge NEW/WORSE exactly as the email does — but **never writes it back** (a midday write would corrupt the evening digest's diff baseline).                                                                  |

## 3. The surface

```text
┌────────────────────────────────────────────────────────────────┐
│  RED DOOR · Fleet Cockpit                     ⟳ updated 6m ago  │
│                                                                  │
│  🔴 3 needs attention    🟡 5 watch    🟢 192 healthy            │
│  2 critical vulns · 3 Lighthouse<75 · 1 delivery · 4 pending     │
│  [ all ][ vulns ][ lighthouse ][ delivery ][ stale ][ pending ] │
├────────────────────────────────────────────────────────────────┤
│   APPROVE (4)  ── your daily yes ──────────────────────────────  │
│  ┌ alamo-anatomy · May report ready    [ approve ] [ open ▸ ] ┐ │
│  ┌ gallerysonder · May report ready     [ approve ] [ open ▸ ] ┐ │
├────────────────────────────────────────────────────────────────┤
│ 🔴 NEEDS ATTENTION (3)                                           │
│ ┌ data-dynamiq ───────────────────────────── ✗ failing ──┐     │
│ │ 🔴 1 critical vuln    Perf 69    last audit 1d ago       │     │
│ │                                  [ open ▸ ]            │     │
│ └─────────────────────────────────────────────────────────┘     │
│ ┌ caltex ─────────────────────────────────── ✗ failing ──┐     │
│ │ 🔴 2 critical vulns   Perf 71   NEW                      │     │
│ └─────────────────────────────────────────────────────────┘     │
│ ┌ acme-co ────────────────────────────── ⚠ delivery ─────┐     │
│ │ ✉ last report bounced                                   │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│ 🟡 WATCH (5)                                        ▸ expand     │
│ 🟢 HEALTHY (192)                                    ▸ expand     │
└────────────────────────────────────────────────────────────────┘
```

**Tier assignment** (per visible site — the existing `dashboardToken !== null` filter is unchanged):

- 🔴 **Needs attention** — the site has **any** `AttentionItem` from the collectors (slice 1: critical/high vuln · delivery bounce/complaint · Lighthouse category < 75. slice 2 adds: Renovate PR failing CI · CI-red).
- 🟡 **Watch** — not red, **and** any of: a Lighthouse category in **[75, 85)** (near the floor), **or** `lastLighthouseAuditAt` older than **30 days** (an audit-coverage gap). Slice 2 adds last-deploy/commit staleness > 30d.
- 🟢 **Healthy** — everything else.

**Sort.** Within 🔴: by max severity (`critical` before `warning`), then total `metric` descending, then name. Within 🟡 / 🟢: alphabetical (today's order).

**Summary bar.** Tier counts + a headline metric line (total critical/high vulns; count of Lighthouse categories below floor; count of delivery failures; pending count) + filter chips. Each filter chip narrows the visible cards client-side (a `data-signal` attribute per card + a few lines of vanilla JS); "pending" jumps to the approve strip.

**Approve strip.** The existing `listPendingApproval` queue, rendered as a pinned section with the existing one-click approve form per row. The M3 approve endpoint and its CSRF guard are untouched.

## 4. Architecture

```text
fleet-homepage.mts handler (one request)
  1. auth (existing verifyBasicAuth) + NEW rate-limit config
  2. fetch ONCE:  listWebsites(base)  ·  listAllReports(base)  ·  readDigestState(base)
  3. buildCockpitModel(websites, reports, priorSnapshot, baseUrl)   ← PURE, fully tested
       • run collectVulnAlerts / collectLighthouseAlerts / collectDeliveryFailures
       • diffAttention(items, priorSnapshot, today) → tag NEW/WORSE  (DISCARD `next`; never written)
       • group tagged items by siteName → assign tier per site
       • compute summary counts, sort tiers, build the pending list (listPendingApproval data)
  4. renderCockpitHtml(model)   ← PURE; static HTML + ~30 lines inline vanilla JS (collapse + filter)
  5. respond 200
```

No write occurs anywhere in the request path. The Digest State read is the only addition beyond what the homepage already fetches, and it is read-only.

## 5. Components

### 5.1 `src/dashboard/fleet-cockpit.ts` (new) — the pure core

```ts
export type Tier = "attention" | "watch" | "healthy";

export type SiteCard = {
  site: WebsiteRow;
  tier: Tier;
  items: AttentionItem[]; // this site's tagged attention items (NEW/WORSE already set), severity-sorted
  watchReasons: string[]; // e.g. ["Lighthouse Performance 80", "audited 41d ago"] — empty unless tier==="watch"
};

export type CockpitSummary = {
  attention: number;
  watch: number;
  healthy: number;
  criticalHighVulns: number; // sum of metric over kind==="vuln"
  lighthouseBelowFloor: number; // count of kind==="lighthouse" items
  deliveryFailures: number; // count of kind==="delivery" items
  pending: number;
};

export type CockpitModel = {
  summary: CockpitSummary;
  cards: SiteCard[]; // all visible sites, tier-grouped then sorted within tier
  pending: PendingApprovalRow[]; // for the pinned approve strip
};

export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
): CockpitModel;
```

`buildCockpitModel` is pure and exhaustively unit-tested. It owns: running the three collectors, calling `diffAttention` purely for the `tagged` output (the `next` snapshot is discarded — the digest owns the daily write), grouping by `siteName`, the tier rules (§3), the summary counts, and the within-tier sort. The Watch thresholds (`LIGHTHOUSE_WATCH_LOW = 75`, `LIGHTHOUSE_WATCH_HIGH = 85`, `AUDIT_STALE_DAYS = 30`) live here as named constants.

`PendingApprovalRow` is whatever `listPendingApproval` already returns; the model passes it through so the renderer stays pure (no Airtable in render).

### 5.2 `src/dashboard/fleet-render.ts` — grows the renderer

`renderFleetHomeHtml` is replaced by `renderCockpitHtml(model: CockpitModel): string`, still pure (no Airtable, no env, no I/O). It renders: the summary bar + filter chips, the pinned approve strip, and the three collapsible tier sections of cards. The card markup reuses today's escaping helpers (`escapeHtml`, `safeUrl`) and metric spans; it gains a status pill, the per-site attention chips (vuln / lighthouse / delivery), and the `NEW`/`WORSE` badge driven by `item.status`. Collapse + filter are ~30 lines of inline vanilla JS keyed off `data-tier` / `data-signal` attributes — no framework, matching the existing server-rendered approach. The empty-fleet and all-healthy states render explicit "all clear" copy.

### 5.3 `netlify/functions/fleet-homepage.mts` — thin wiring

Adds the `listAllReports` + `readDigestState` fetches (each wrapped defensively — a Reports or State hiccup degrades to an empty list / `{}` so the page still renders), calls `buildCockpitModel` then `renderCockpitHtml`. The `Config` gains the rate-limit declaration (§7). Auth is unchanged.

### 5.4 `src/dashboard/auth.ts` (new, optional consolidation)

The Sec-Fetch-Site / Origin CSRF guard currently living in the approve function moves here alongside a re-export of `verifyBasicAuth`, so the (POST) approve endpoint and any future state-changing endpoint share one implementation. The homepage is a read-only GET and needs no CSRF guard — only the rate-limit. This consolidation is small; the plan may fold it into slice 1 or skip it if it adds churn without a second consumer yet.

## 6. Airtable schema

**Slice 1: no schema change.** Every signal it renders already lives in the Websites and Reports tables (vulns, Lighthouse scores, `deliveryStatus`, `lastLighthouseAuditAt`) or in the existing "Digest State" record.

**Slice 2 (separate plan):** the nightly audit/digest cron persists per-site **Renovate-failing-PR count**, **CI status**, and **last-deploy timestamp** into new Websites fields (names TBD in that plan), so the cockpit reads them with zero request-path GitHub calls. Additive only.

## 7. Auth hardening

The internet-facing-ops concern from the roadmap research, scoped to what's actually missing:

- **Already done:** the password compare is **constant-time** ([basic-auth.ts:39](../../../src/dashboard/basic-auth.ts)), and the approve POST already carries a Sec-Fetch-Site CSRF guard. No change needed.
- **New: Netlify native rate-limiting** on the homepage (and approve) function to blunt password brute-force — declared in the function `Config` / `netlify.toml` (per-IP request cap). This is the one genuinely missing control.
- **Consolidation (optional, §5.4):** one shared auth helper rather than two copies of the guard.

Single-operator, single-password is retained deliberately (per-site tokens already retired); session cookies / multi-user are out of scope (YAGNI for one operator).

## 8. Error handling

- **Per-collector isolation** is inherited: the collectors are pure and already individually safe; `buildCockpitModel` runs them over fetched data, and a malformed row contributes nothing rather than throwing.
- **Defensive fetches:** a failed `listAllReports` → empty reports (no delivery/pending signals, page still renders); a failed/parse-miss `readDigestState` → `{}` (everything badges as not-NEW, never crashes) — same degradation the digest already relies on.
- **No request-path writes**, so there is no partial-write failure mode to handle.

## 9. Research basis (2026-06-11)

- **Triage dashboard at ~200 rows:** render-all + client-side filter/sort beats server pagination at this scale (200 cards is well within a single DOM payload); htmx is the noted future upgrade if the page ever needs server round-trips. Health-tier grouping + collapse is the standard pattern for "surface the few, fold the many" (Google SRE "novel + actionable"; status-dashboard prior art).
- **Single-password ops view:** keep Basic Auth + add native rate-limiting (brute-force is the real threat for a single shared secret); constant-time compare already closes the timing side-channel. Session handling / multi-user is unjustified for one operator.
- **Backstage-style catalog:** borrow the _patterns_ (summary chips, health grouping, per-entity signals) — not the tool. A bespoke server-rendered page over our existing Airtable state is far lighter than standing up Backstage's plugin/catalog infra for ~200 static rows.

## 10. Out of scope (explicit)

- **Slice 2** — Renovate-failing / CI-red / last-deploy signals (needs the cron to persist them per-site first). Its own plan.
- **Trigger-audit-from-the-page** — deferred post-1.0 (existing decision).
- **Sessions / multi-user / SSO** — single operator, single password retained.
- **Server-side pagination / virtualized lists** — unnecessary at 200; revisit only if the fleet outgrows a single-payload render.
- **A sortable data-table view** — Tucker chose cards; not building a second layout.

## 11. Slice breakdown (for the plan)

Dependency-ordered; each TDD + the AUTONOMY.md 3-lens review, its own PR.

**Slice 1 — the cockpit surface + Airtable-resident signals + rate-limiting** (full TDD plan):

1. **The pure core** — `src/dashboard/fleet-cockpit.ts`: `buildCockpitModel` (tier rules, summary, sort, NEW/WORSE via read-only `diffAttention`). Fully unit-tested against the fake-airtable-base fixtures; nothing wired.
2. **The renderer** — `renderCockpitHtml` in `fleet-render.ts`: summary bar + filter chips + approve strip + collapsible tiers + inline collapse/filter JS. Structural/snapshot tests pin the HTML invariants (charset, https links, the approve form, the collapse JS present, `data-tier`/`data-signal` hooks).
3. **Wire + harden** — `fleet-homepage.mts`: add the `listAllReports` + `readDigestState` fetches (defensive), call model→render; add the rate-limit `Config`; (optional) factor `src/dashboard/auth.ts`.

**Slice 2 — GitHub-sourced signals** (sketch; separate plan): the nightly cron persists Renovate-failing-PR count / CI status / last-deploy per-site to new Websites fields; `buildCockpitModel` reads them into the tier rules (red on Renovate-failing or CI-red; watch on deploy-staleness > 30d) and the renderer lights up the `⬆ PRs failing` and staleness chips. No request-path GitHub calls.

## 12. Success criteria

Opening `/` shows, above the fold: the tier counts and headline triage line; the approve queue with working one-click approve; and a 🔴 Needs-attention section listing exactly the sites carrying a live vuln / delivery failure / sub-75 Lighthouse category, ranked worst-first, each card showing its signals with NEW/WORSE badges that match the day's email digest. The healthy ~190 sites are one folded section. The page renders fast (no live GitHub/Lighthouse calls) and is rate-limited against brute-force. The operator's morning glance now answers "what's broken?" as directly as "what's ready to send?".
