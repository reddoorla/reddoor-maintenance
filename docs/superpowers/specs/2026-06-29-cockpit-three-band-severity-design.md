# Cockpit three-band severity — Design

> **Status:** approved 2026-06-29, ready for implementation plan.
> **Scope:** `src/dashboard/fleet-cockpit.ts` + `src/dashboard/fleet-render.ts`. Pure functions, no Airtable/schema changes, no new collectors.

## Problem

The cockpit verdict bar is **binary**: green `✓ All clear`, or red `⚠ N sites need you`
([`fleet-render.ts` `verdictBar`](../../../src/dashboard/fleet-render.ts)). A genuinely-down site
and a "waiting on your yes" site wear the same alarm-red, and the single red count flattens the
three groups the Needs-you feed already distinguishes (broken → approval → slipping).

Worse, there is a **dishonest blind spot**: a vuln only reaches the feed/verdict once Renovate's
auto-fix is _exhausted_ (`item.autoFixExhausted`, ≥3 dispatch cycles). A site whose only problem
is a still-self-patching CVE is tier `attention` (red card in the browse grid) but produces **zero
feed rows and zero verdict count** — so `✓ All clear` can show while a site silently carries an
active critical/high vuln the fleet is still patching.

## Goal

Introduce an intermediate **amber "Watch"** severity band between hard-broken and the soft
approval band, so the top-of-page glance reads honestly:

- 🔴 **Broken** — something is wrong, act now.
- 🟡 **Watch** — the system is aware / handling it; no action needed yet (but _not_ "all clear").
- 🔵 **Waiting on your yes** — the only thing that is purely your move.

## The three-band model

| Band                    | Color    | Feed group          | What's in it                                                                                                                                                                                        |
| ----------------------- | -------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Broken**              | 🔴 red   | `broken` (rank 0)   | Hard breaks: failed deploy, sub-floor Lighthouse (<75), CI red, delivery failures, **vulns with `autoFixExhausted === true`**                                                                       |
| **Watch**               | 🟡 amber | `watch` (rank 1)    | **Self-patching vulns** (vuln item, `autoFixExhausted !== true`) · the **entire current watch tier**: degrading Lighthouse [75,85), stale repo (>30d no commit), no custom domain (`*.netlify.app`) |
| **Waiting on your yes** | 🔵 blue  | `approval` (rank 2) | A pending report draft is ready to approve/send                                                                                                                                                     |

`NeedsYouGroup` changes from `"broken" | "approval" | "slipping"` to
**`"broken" | "watch" | "approval"`**. The `slipping` group is removed — the soft watch-tier
reasons (stale, no-domain) and the degrading reason (Lighthouse 75–85) all fold into `watch`.

One row per site; a site's `group` is its **worst** band, and its `reasons[]` combine every
reason found. The amber band is **informational, not an alarm** — its verdict copy never says
"need you".

## Classification (all inside `buildNeedsYouFeed`)

`buildNeedsYouFeed(model)` is rewritten to bucket each site, then pick the worst band:

1. **attention-tier card** (`card.tier === "attention"`):
   - Partition `card.items` into:
     - **hard-broken** = every item that is NOT a self-patching vuln, i.e. NOT
       (`item.kind === "vuln" && item.autoFixExhausted !== true`). This includes deploy/CI/
       Lighthouse/delivery items **and exhausted vulns**.
     - **self-patching vulns** = `item.kind === "vuln" && item.autoFixExhausted !== true`.
   - If `hardBroken.length > 0` → site is **`broken`**; reasons = hard-broken titles
     (self-patching vulns are _not_ listed — the site is already red; matches today's behavior
     where the gate skips non-exhausted vulns).
   - Else (only self-patching vulns) → site is **`watch`**; reasons = the vuln titles.
   - `hasCritical` = any hard-broken item has `severity === "critical"` (drives within-broken
     ordering, unchanged).

2. **watch-tier card** (`card.tier === "watch"`, `watchReasons.length > 0`) → site is **`watch`**;
   reasons = `card.watchReasons` (wholesale — no per-signal split needed).

3. **pending report** (`model.pending`) → site is **`approval`**; reason
   = `` `${reportType} ${period} ready` `` (unchanged).

A site accumulating reasons across buckets keeps **one** row; its `group` is the worst band by
rank (`broken` < `watch` < `approval`). Example: a watch-tier site that also has a pending report
→ `watch` (amber), with both reasons listed.

### Ordering

`buildNeedsYouFeed` returns items sorted by:

1. group rank (`broken` 0, `watch` 1, `approval` 2),
2. within `broken`: `hasCritical` first,
3. then site name (case-insensitive).

(Same shape as today, with the rank map updated for the new group set.)

## Verdict bar — four states (worst band wins)

`verdictBar` takes per-band site counts (derived from the feed) instead of a single `feedCount`.
It renders the **worst active band's** headline + color, with every lower band's count plus the
healthy count in the meta line (zero terms omitted). Healthy count = total cards − sites in feed.

```text
🟢  ✓ All clear          18 sites healthy · audited 2h ago
🔵  3 waiting on you      · 15 healthy
🟡  2 sites to watch      · 3 waiting on you · 13 healthy
🔴  ⚠ 2 sites broken      · 2 watching · 3 waiting on you · 11 healthy
```

State selection:

- `broken > 0` → red, `.verdict warn`, headline `⚠ {broken} site(s) broken`.
- else `watch > 0` → amber, `.verdict watch`, headline `{watch} site(s) to watch`.
- else `approval > 0` → blue, `.verdict soft`, headline `{approval} waiting on you`.
- else → green, `.verdict ok`, headline `✓ All clear`.

Meta-line terms (in band order, each shown only when > 0, after the headline's own band):
`{watch} watching`, `{approval} waiting on you`, `{healthy} healthy`. The audit-recency suffix
(`· fleet last audited …`) is preserved in every state. The `↻ Audit fleet` button + live status
panel stay in the bar unchanged.

### New CSS

Add `.verdict.watch` (amber: light `#fff8e1` / text `#8a6d00`, dark `#2a2410` / `#ffd454`) and
`.verdict.soft` (blue/neutral: light `#e7f1fb` / text `#1c5d99`, dark `#0f1d2a` / `#7fb6e8`),
mirroring the existing `.ok` / `.warn` light+dark pairs. Pick tokens consistent with the current
palette during implementation.

## Feed rendering

`renderNeedsYouFeed`:

- group iteration order → `["broken", "watch", "approval"]`.
- `NEEDS_YOU_GROUP_LABEL` → `{ broken: "Broken", watch: "Watch", approval: "Waiting on your yes" }`.
- Add a `.dot.watch` amber swatch (alongside the existing `.dot.broken` / `.dot.approval`); drop
  `.dot.slipping`.

```text
Needs you (7)
  Broken              🔴 caltex   — Lighthouse Performance 41 (below 75)   Open ▸
  Watch               🟡 revogen  — 2 critical/high vulns                  Open ▸
                      🟡 vineyard — Performance 82                         Open ▸
                      🟡 espada   — last commit 45 days ago                Open ▸
  Waiting on your yes 🔵 erp      — Maintenance June ready                 Open ▸
```

Rows stay navigation-only (`Open ▸` → `/s/<slug>`). The client-side group filter, if present,
keys off `data-group` — update its allowed values to the new set.

## Data shapes

- `NeedsYouGroup = "broken" | "watch" | "approval"`.
- `NeedsYouItem` is unchanged in shape (`group`, `hasCritical`, `slug`, `siteName`, `reasons`,
  `url`).
- `verdictBar(model, counts)` where `counts = { broken, watch, approval }` (site counts by group);
  healthy is derived inside as `model.cards.length − (broken + watch + approval)`. Counts are
  computed from the feed in the caller (or a small pure helper `needsYouCounts(feed)`).
- `assignTier` and `SiteCard` are **unchanged** — the whole watch tier maps to amber, so no
  per-signal tagging of `watchReasons` is required.
- `CockpitSummary.autoFixStuck` and the browse-grid card rendering are unaffected.

## Edge cases

- **Mixed attention site** (failed deploy **and** a self-patching vuln) → `broken`; the vuln is
  not separately listed (today's behavior preserved).
- **Exhausted vuln** → hard-broken → `broken` (red), exactly as today.
- **Self-patching vuln only** → `watch` (amber) — the bug this fixes; previously invisible.
- **Watch-tier site with multiple reasons** (e.g. Lighthouse 82 + stale) → one `watch` row, both
  reasons joined.
- **Site with a pending report that is also broken/watch** → worst band wins (`broken` or
  `watch`); the approval reason still appears in that row's `reasons`.
- **Empty feed** → green `✓ All clear` (unchanged trigger).

## Testing

Pure-function unit tests (Vitest), extending the existing `buildNeedsYouFeed` / verdict suites:

- `buildNeedsYouFeed`:
  - self-patching vuln only → `group: "watch"` (regression-guards the blind spot).
  - exhausted vuln → `group: "broken"`.
  - hard-broken + self-patching vuln on one site → `broken`, vuln not listed.
  - watch-tier (lighthouse 82 / stale / no-domain) → `watch`.
  - pending report → `approval`; broken+pending on one site → `broken` with the approval reason
    present.
  - ordering: broken-before-watch-before-approval; critical-first within broken; name tiebreak.
- verdict band selection: all four states from representative count tuples, including the
  meta-line term omission (zero terms hidden) and the worst-band headline.

## Non-goals

- No new Airtable fields, collectors, or audits.
- No change to `assignTier` thresholds or to what counts as attention vs watch.
- No change to the browse-grid card tiering/colors, the Recently lane, or submissions lanes.
- No reordering of approval above watch — severity order (broken > watch > approval) is intentional.
