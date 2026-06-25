# Cockpit Reorganization — "Verdict + Needs-you feed" Design

**Date:** 2026-06-25
**Status:** Approved design, ready for implementation plan
**Scope:** Dashboard render reorganization of the fleet cockpit (`/`). No new endpoints, no Airtable/libSQL schema changes. Ships on a `main` redeploy (not an npm publish).

---

## Goal

Reorganize the fleet cockpit homepage around the operator's actual job — **"check nothing's on fire"** — so the page answers *"is anything wrong?"* in one glance and only surfaces detail when something needs the operator. Today the cockpit is organized by the features that were appended over time, not by how it's used.

## Background — the six incoherences this fixes

From a top-to-bottom read of `renderCockpitHtml`:

1. **Two navigation systems collide.** The filter chips (`vulns / lighthouse / ci / …`) hide cards with `display:none`, but cards live inside `<details>` tiers where Watch + Healthy are collapsed by default. Filtering can surface *zero visible cards* because the matches are inside a collapsed tier.
2. **The summary bar front-loads 8 numbers + 11 filters** before any decision.
3. **The approve queue — the keystone of the approve-only-loop vision — has the same visual weight as spam stats.**
4. **Actions are scattered with no model** (approve ×2, Trigger Renovate per-card + per-site, Refresh alone), and nothing shows what's running.
5. **Two different inboxes are mashed together** (report approvals vs. visitor form submissions) with near-identical styling.
6. **The fleet's autonomy is invisible** — it only ever shows problems, never "the fleet handled X for you."

## Decisions (locked with the operator)

- **Primary job:** alarm board — *check nothing's on fire*. Approvals are secondary; visitor submissions are tertiary.
- **Top "needs me" zone includes:** hard breakage + soft degradation + report approvals. **Visitor submissions do NOT** break the verdict — they live in their own quiet lane.
- **Every Needs-you row is navigation-only:** a single **Open ▸** button → `/s/<slug>`. No inline Approve / Trigger Renovate in the feed. The feed says *what* needs you; the site page (already full-featured) is *where* you fix it, with full context.
- **One row per site (collapsed):** a site that needs you for several reasons is a single row listing them all (not one row per issue). The row links once to its page. The feed length is therefore the count of *sites* that need you.
- **Vulns only alarm after the fleet gives up:** a vuln enters the feed **only when `autoFixExhausted` is set** (Renovate retried the OSV fix past the exhaustion threshold — the existing `Security Auto-Fix Attempts ≥ 3` signal). While Renovate is still on it, it stays off the verdict and out of the feed. **`✓ All clear` can show while the fleet quietly patches vulns in the background.**
- **Fleet + Inboxes stay collapsed by default** (`<details>` without `open`). The operator expands them when browsing.
- **Fleet panel keeps its per-card Trigger Renovate button** (operator's choice). The home page's other action is the verdict-bar **↻ Audit** button.
- **Relabel `↻ Refresh` → `↻ Audit`** — more accurate (it dispatches the security + Lighthouse sweeps) and keeps the live-status spinner shipped in #309/#310.

## Architecture

The cockpit becomes four stacked regions, top to bottom:

```text
┌─────────────────────────────────────────────┐
│ VERDICT BAR   ✓ All clear  /  ⚠ N need you   │  ← the glance; count = feed length
│   N sites · fleet last audited 2h ago · ↻ Audit
├─────────────────────────────────────────────┤
│ NEEDS YOU (only when N > 0)                  │  ← one ranked feed, every row → Open ▸
│   Broken · Waiting on your yes · Slipping     │
├─────────────────────────────────────────────┤
│ ▸ Fleet (N)   [collapsed <details>]          │  ← all cards in ONE grid + filter chips
├─────────────────────────────────────────────┤
│ ▸ Submissions (N new) · 🛡 Spam (30d)         │  ← quiet inbox lane [collapsed <details>]
└─────────────────────────────────────────────┘
```

The data model (`CockpitModel`) is unchanged — it already carries `cards` (with `items[].autoFixExhausted`), `pending`, `submissions`, and `spam`. This is a **render-layer reorganization plus one pure data builder** over the existing model. The existing `buildCockpitModel` tiering is untouched; the Needs-you feed is a *separate, curated* view layered on top.

### Verdict vs. Fleet panel may diverge — by design

The verdict/feed shows only what needs the *operator*. The Fleet panel shows full state. A site with an in-flight (non-exhausted) vuln is still a 🔴 attention card inside the Fleet panel, but it is **not** in the feed and does **not** raise the verdict. This divergence is intentional and documented so it doesn't read as a bug.

## Components

### 1. `buildNeedsYouFeed(model)` — new pure builder in `src/dashboard/fleet-cockpit.ts`

```ts
export type NeedsYouGroup = "broken" | "approval" | "slipping";

export type NeedsYouItem = {
  /** The site's worst category present — drives the dot color, the group sub-label, and ordering. */
  group: NeedsYouGroup;
  /** True when any of the site's broken items is `severity: "critical"` (within-broken ordering). */
  hasCritical: boolean;
  slug: string;
  siteName: string;
  /** Every reason this site needs you, combined into one row. */
  reasons: string[];
  /** Always `/s/${slug}`. */
  url: string;
};

export function buildNeedsYouFeed(model: CockpitModel): NeedsYouItem[];
```

**One row per site.** Accumulate reasons per site (keyed by `siteSlug(name)` — `siteSlug` is already imported in this file), then assign each site its worst category:

- **Broken reasons** — for each `card` with `tier === "attention"`, for each `item` in `card.items`: **skip** when `item.kind === "vuln" && item.autoFixExhausted !== true` (the gate); otherwise add `item.title` to that site's reasons and set `hasCritical ||= item.severity === "critical"`.
- **Approval reasons** — for each `p` in `model.pending`: add `` `${p.reportType} ${p.period} ready` `` to that site's reasons.
- **Slipping reasons** — for each `card` with `tier === "watch"`: add each of `card.watchReasons`.

A site's `group` is the worst category for which it has ≥1 reason: `broken` > `approval` > `slipping`. A site with **no** reasons (e.g. an attention-tier site whose only item is a non-exhausted vuln, with no pending report) is omitted entirely — so it never raises the verdict.

Ordering: by group (`broken` 0 → `approval` 1 → `slipping` 2); within `broken`, `hasCritical` first; then `siteName` ascending (lowercased locale compare). Slug agreement: `pending[].slug` is already `siteSlug(name)`, the same value computed for cards, so the per-site keys merge correctly across sources.

### 2. `fleetLastAuditedAt(cards)` — new pure helper in `src/dashboard/fleet-cockpit.ts`

```ts
/** Most recent `lastLighthouseAuditAt` across the cards, or null if none recorded. */
export function fleetLastAuditedAt(cards: SiteCard[]): string | null;
```

Iterate `cards`, parse each `card.site.lastLighthouseAuditAt` (skip null / non-finite), return the ISO string of the max. Rendered via `relativeTimeFromNow(iso, now)`.

### 3. Verdict bar — replaces the header + `summaryBar` + `allClearBanner`

- `count = feed.length` (the number of *sites* that need you); `allClear = count === 0`.
- **All clear:** green block, `✓ All clear`, meta line `${cards.length} sites healthy · fleet last audited ${rel} · ↻ Audit`.
- **Needs you:** red block, `⚠ ${count} ${count === 1 ? "site needs" : "sites need"} you`, meta line `${cards.length} sites · fleet last audited ${rel}`, plus the **↻ Audit** button.
- The `fleet last audited ${rel}` clause is omitted when `fleetLastAuditedAt` is null.
- The Audit button reuses the existing refresh dispatch + live-status polling client script (relabel only).

### 4. Needs-you feed render — replaces `approveStrip` + the attention surfacing

Rendered only when `feed.length > 0`. A single bordered list with three group sub-labels (`Broken` / `Waiting on your yes` / `Slipping`) shown only when that group is non-empty. Each row is **one site**: a dot colored by `item.group` (red `broken` / blue `approval` / amber `slipping`), `${siteName} — ${item.reasons.join(" · ")}`, and an **Open ▸** anchor to `item.url`. A site appears under exactly one group (its worst category), with every reason combined in that single row. No fetch/JS — pure links.

### 5. Fleet panel — collapsed browse, filter bug fixed

A single `<details>` (no `open`) titled `Fleet (${cards.length})`. Inside, in order:

- The filter chips (the existing `FILTERS` set), scoped to this panel.
- **One flat card grid** containing every card in the model's existing tier order (attention → watch → healthy). The nested per-tier `<details>` sections are **removed** — this is what fixes incoherence #1: filters now toggle `display` on cards within a single always-rendered container, so a filtered card can never hide inside a collapsed tier. Tier remains visible per-card via the existing tier pill (and an optional non-collapsible visual divider between tiers).
- Cards keep `cockpitCard` rendering, including the per-card **Trigger Renovate** button and its existing fetch handler.

### 6. Inboxes — collapsed quiet lane

A single `<details>` (no `open`) combining `submissionsStrip` (newest-10 cap + "View all →") and `spamRollup` into one muted region. Submissions are never counted in the verdict.

### 7. Client scripts

- **Audit/refresh + live status:** existing `rfPoll`/`rfRender` script, relocated into the verdict bar; button label "Audit". Unchanged behavior.
- **Filter script:** existing `FILTER_SCRIPT`, scoped to the Fleet panel's card grid.
- **Approve fetch handler:** **removed from the cockpit home** — approvals now navigate to the site page. (The per-site page keeps its approve handler unchanged.)
- **Trigger Renovate handler:** retained for the Fleet panel cards.

## Data flow

`index.ts` → `buildCockpitModel(...)` (unchanged) → `renderCockpitHtml(model, now, ...)`. Inside the renderer: `const feed = buildNeedsYouFeed(model)` and `const auditedAt = fleetLastAuditedAt(model.cards)` drive the verdict + feed; `model.cards` drives the Fleet panel; `model.submissions` + `model.spam` drive the inbox lane.

## File structure

- **`src/dashboard/fleet-cockpit.ts`** — add `NeedsYouGroup`, `NeedsYouItem`, `buildNeedsYouFeed`, `fleetLastAuditedAt`. (Currently 278 lines; these are pure additions.)
- **`src/dashboard/fleet-render.ts`** — rewrite `renderCockpitHtml` to verdict → feed → Fleet panel → inboxes. It is 542 lines today; extract the **Fleet browse panel** (card grid + filter chips + filter script) into a new **`src/dashboard/fleet-browse-render.ts`** so `fleet-render.ts` stays focused on the verdict + feed + page shell. The inbox lane stays a small helper in `fleet-render.ts`.
- No other files change.

## Testing

- **`buildNeedsYouFeed`** (unit): **one row per site** (a site with multiple broken items → one row whose `reasons` lists them all; a broken site that also has a pending report → one row under `broken` whose `reasons` include the report); group ordering (broken → approval → slipping) with `hasCritical` first inside broken, then name; vuln gating (an exhausted vuln contributes a reason, a non-exhausted vuln does not, and an attention site whose *only* item is a non-exhausted vuln with no pending report is omitted entirely); approval-only and slipping-only sites; empty model → `[]`.
- **`fleetLastAuditedAt`** (unit): returns the max ISO; skips null and non-finite; all-null → `null`.
- **`renderCockpitHtml`** (render-string): verdict shows `✓ All clear` when feed empty and `⚠ N sites need you` (singular `1 site needs you`) when not; `N` equals feed length (number of sites) and **excludes** submissions; each feed row renders an `Open ▸` link to `/s/<slug>`; Fleet panel is a single collapsed `<details>` containing the filter chips and all cards in **one** grid with **no nested tier `<details>`**; per-card Trigger Renovate present; Inboxes render as a collapsed `<details>`; no approve button on the home page; the Audit button is labeled "Audit".
- Existing handler/endpoint tests are untouched (no API changes).

## Out of scope (YAGNI)

- No new endpoints; no Airtable/libSQL schema changes.
- No server-side filtering (the Fleet panel filters stay client-side).
- The per-site page (`/s/<slug>`) is unchanged.
- The numeric auto-fix attempt count (e.g. "×4") is not plumbed into feed labels; the boolean `autoFixExhausted` gate is sufficient.

## Roadmap ideas surfaced (captured, not built here)

1. **Fleet activity feed** — beyond "last audited Xh ago," an actual *"what the fleet did for you today"* log (PRs auto-merged, sites re-audited). The real fix for invisible autonomy (incoherence #6).
2. **One-click fixes for more alarm types** — delivery-failure and CI-red have no inline action; add GitHub run deep-links or retry actions (would relax the navigation-only rule for specific kinds).
3. **Server-side Fleet filtering / its own route** if the browse panel outgrows a client-side toggle.

## Release

One changeset, **minor** (user-facing dashboard reorganization). Goes live on the next `main` redeploy of the dashboard; no npm publish required (no `./forms` / `./configs` surface touched).
