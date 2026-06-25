# Cockpit Reorg — Verdict + Needs-you Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the fleet cockpit (`/`) around the "check nothing's on fire" job — a glance verdict on top, a single per-site navigation-only "Needs you" feed, and collapsed Fleet + Inbox lanes — fixing the filter-vs-collapsed-tier bug and gating vuln alarms on auto-fix exhaustion.

**Architecture:** Two new PURE functions in `src/dashboard/fleet-cockpit.ts` (`buildNeedsYouFeed`, `fleetLastAuditedAt`) drive a rewritten `renderCockpitHtml` in `src/dashboard/fleet-render.ts`. The card-grid browser is extracted into a new `src/dashboard/fleet-browse-render.ts`. No new endpoints, no Airtable/libSQL changes; the caller ([netlify/functions/fleet-homepage.mts](../../../netlify/functions/fleet-homepage.mts) line 140) keeps calling `renderCockpitHtml(model)` unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, server-rendered HTML strings, tsup build.

**Spec:** [docs/superpowers/specs/2026-06-25-cockpit-reorg-needs-you-feed-design.md](../specs/2026-06-25-cockpit-reorg-needs-you-feed-design.md)

---

## Conventions for every task

- Run a single test file fast with: `npx vitest run <path>` (avoids the `pretest` full build).
- Imports use `.js` specifiers even for `.ts` files (ESM/NodeNext). Follow the existing files.
- `escapeHtml` / `safeUrl` come from `../util/html.js`. Always escape interpolated text.
- Commit after each task with the shown message. Use `git add <explicit paths>` (never `git add -A`).
- Inline client `<script>` strings use **string concatenation only — no backticks / `${}`** (they live inside a TS template literal). This rule already governs the existing refresh script.

## File structure (responsibilities after this plan)

- `src/dashboard/fleet-cockpit.ts` — cockpit data model + **new** `buildNeedsYouFeed`, `fleetLastAuditedAt`, `NeedsYouGroup`, `NeedsYouItem`.
- `src/dashboard/fleet-render.ts` — page shell, `verdictBar`, `renderNeedsYouFeed`, `renderInboxLane`, `AUDIT_SCRIPT`, and the `renderCockpitHtml` orchestrator. Stylesheet (`STYLES`) lives here.
- `src/dashboard/fleet-browse-render.ts` — **new**: the card-grid browser (`card` + score/health spans, `cockpitCard`, `chips`, `signalsAttr`, `triggerRenovateBtn`, `submBadge`, `PILL_LABEL`, `attentionBadge`), the `FLEET_FILTERS` list, `renderFleetBrowsePanel`, and `FLEET_BROWSE_SCRIPT`.

---

## Task 1: `fleetLastAuditedAt` helper

**Files:**
- Modify: `src/dashboard/fleet-cockpit.ts` (add export near the other pure helpers, after `buildCockpitModel`)
- Test: `tests/dashboard/fleet-cockpit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard/fleet-cockpit.test.ts`. It already imports from `../../src/dashboard/fleet-cockpit.js` and has `makeWebsiteRow` available via its existing helpers — add `fleetLastAuditedAt` to the import and a `SiteCard` import.

```ts
import { buildCockpitModel, fleetLastAuditedAt } from "../../src/dashboard/fleet-cockpit.js";
import type { SiteCard } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function healthyCard(name: string, lastLighthouseAuditAt: string | null): SiteCard {
  return {
    site: makeWebsiteRow({ name, lastLighthouseAuditAt }),
    tier: "healthy",
    items: [],
    watchReasons: [],
    watchSignals: [],
  };
}

describe("fleetLastAuditedAt", () => {
  it("returns null for no cards", () => {
    expect(fleetLastAuditedAt([])).toBeNull();
  });
  it("returns null when every card has no audit timestamp", () => {
    expect(fleetLastAuditedAt([healthyCard("A", null), healthyCard("B", null)])).toBeNull();
  });
  it("returns the most recent ISO timestamp", () => {
    const cards = [
      healthyCard("A", "2026-06-20T10:00:00Z"),
      healthyCard("B", "2026-06-24T09:00:00Z"),
      healthyCard("C", null),
    ];
    expect(fleetLastAuditedAt(cards)).toBe("2026-06-24T09:00:00Z");
  });
  it("skips unparseable timestamps", () => {
    const cards = [healthyCard("A", "not-a-date"), healthyCard("B", "2026-06-01T00:00:00Z")];
    expect(fleetLastAuditedAt(cards)).toBe("2026-06-01T00:00:00Z");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboard/fleet-cockpit.test.ts -t fleetLastAuditedAt`
Expected: FAIL — `fleetLastAuditedAt is not a function` / not exported.

- [ ] **Step 3: Implement `fleetLastAuditedAt`**

Add to `src/dashboard/fleet-cockpit.ts` (anywhere after the `CockpitModel` type and `buildCockpitModel`):

```ts
/** Most recent `lastLighthouseAuditAt` across the cards, or null if none recorded.
 *  Drives the cockpit verdict's "fleet last audited Xh ago" line. PURE. */
export function fleetLastAuditedAt(cards: SiteCard[]): string | null {
  let latestIso: string | null = null;
  let latestMs = -Infinity;
  for (const c of cards) {
    const iso = c.site.lastLighthouseAuditAt;
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestIso = iso;
    }
  }
  return latestIso;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard/fleet-cockpit.test.ts -t fleetLastAuditedAt`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(dashboard): fleetLastAuditedAt helper for the cockpit verdict"
```

---

## Task 2: `buildNeedsYouFeed` per-site builder

**Files:**
- Modify: `src/dashboard/fleet-cockpit.ts` (add types + builder; `siteSlug` is already imported there)
- Test: `tests/dashboard/fleet-cockpit.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard/fleet-cockpit.test.ts`. Extend the import to include `buildNeedsYouFeed`, the new types, and supporting model types. You will hand-build minimal `CockpitModel`s so the feed logic is tested directly.

```ts
import {
  buildCockpitModel,
  fleetLastAuditedAt,
  buildNeedsYouFeed,
} from "../../src/dashboard/fleet-cockpit.js";
import type {
  SiteCard,
  CockpitModel,
  CockpitSummary,
  PendingEntry,
} from "../../src/dashboard/fleet-cockpit.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import { siteSlug } from "../../src/reports/airtable/websites.js";

const ZERO_SUMMARY: CockpitSummary = {
  attention: 0, watch: 0, healthy: 0, criticalHighVulns: 0, lighthouseBelowFloor: 0,
  deliveryFailures: 0, renovateFailing: 0, ciRed: 0, autoFixStuck: 0, pending: 0, newSubmissions: 0,
};

function feedModel(over: Partial<CockpitModel>): CockpitModel {
  return { summary: ZERO_SUMMARY, cards: [], pending: [], submissions: [], spam: null, ...over };
}

function attnCard(name: string, items: AttentionItem[]): SiteCard {
  return { site: makeWebsiteRow({ name }), tier: "attention", items, watchReasons: [], watchSignals: [] };
}
function watchCard(name: string, reasons: string[]): SiteCard {
  return { site: makeWebsiteRow({ name }), tier: "watch", items: [], watchReasons: reasons, watchSignals: ["lighthouse"] };
}
function vuln(name: string, opts: { exhausted?: boolean; severity?: "critical" | "warning" } = {}): AttentionItem {
  return { key: "vuln:" + name, kind: "vuln", siteName: name, title: (opts.severity ?? "critical") + " vuln",
    severity: opts.severity ?? "critical", metric: 1, autoFixExhausted: opts.exhausted ?? false };
}
function ci(name: string): AttentionItem {
  return { key: "ci:" + name, kind: "ci", siteName: name, title: "CI red", severity: "critical", metric: 1 };
}
function delivery(name: string): AttentionItem {
  return { key: "delivery:" + name, kind: "delivery", siteName: name, title: "reports failing to send", severity: "warning", metric: 1 };
}
function pending(name: string, reportType = "Maintenance", period = "2026-Q2"): PendingEntry {
  return { reportId: "r-" + name, siteName: name, slug: siteSlug(name), reportType: reportType as PendingEntry["reportType"], period };
}

describe("buildNeedsYouFeed", () => {
  it("returns [] for an empty model", () => {
    expect(buildNeedsYouFeed(feedModel({}))).toEqual([]);
  });

  it("collapses multiple broken items of one site into a single row", () => {
    const feed = buildNeedsYouFeed(feedModel({ cards: [attnCard("Acme", [ci("Acme"), delivery("Acme")])] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ group: "broken", siteName: "Acme", url: "/s/" + siteSlug("Acme") });
    expect(feed[0].reasons).toEqual(["CI red", "reports failing to send"]);
  });

  it("excludes a vuln until auto-fix is exhausted", () => {
    const inflight = buildNeedsYouFeed(feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: false })])] }));
    expect(inflight).toEqual([]); // fleet still handling it → not your problem yet
    const stuck = buildNeedsYouFeed(feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: true })])] }));
    expect(stuck).toHaveLength(1);
    expect(stuck[0].group).toBe("broken");
  });

  it("merges a broken site's pending report into the same broken row", () => {
    const feed = buildNeedsYouFeed(feedModel({
      cards: [attnCard("Acme", [ci("Acme")])],
      pending: [pending("Acme")],
    }));
    expect(feed).toHaveLength(1);
    expect(feed[0].group).toBe("broken");
    expect(feed[0].reasons).toEqual(["CI red", "Maintenance 2026-Q2 ready"]);
  });

  it("surfaces an approval on an otherwise-healthy site", () => {
    const feed = buildNeedsYouFeed(feedModel({ pending: [pending("Beta")] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ group: "approval", siteName: "Beta" });
    expect(feed[0].reasons).toEqual(["Maintenance 2026-Q2 ready"]);
  });

  it("surfaces a watch site as slipping", () => {
    const feed = buildNeedsYouFeed(feedModel({ cards: [watchCard("Gamma", ["Performance 68"])] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ group: "slipping", siteName: "Gamma" });
    expect(feed[0].reasons).toEqual(["Performance 68"]);
  });

  it("orders broken → approval → slipping, critical-first within broken, then by name", () => {
    const feed = buildNeedsYouFeed(feedModel({
      cards: [
        watchCard("Zeta", ["SEO 80"]),
        attnCard("Delta", [delivery("Delta")]),          // broken, no critical
        attnCard("Apex", [ci("Apex")]),                  // broken, critical
      ],
      pending: [pending("Yara")],                        // approval
    }));
    expect(feed.map((f) => f.siteName)).toEqual(["Apex", "Delta", "Yara", "Zeta"]);
    expect(feed.map((f) => f.group)).toEqual(["broken", "broken", "approval", "slipping"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboard/fleet-cockpit.test.ts -t buildNeedsYouFeed`
Expected: FAIL — `buildNeedsYouFeed is not a function`.

- [ ] **Step 3: Implement the types + builder**

Add to `src/dashboard/fleet-cockpit.ts` (after the `CockpitModel` type):

```ts
export type NeedsYouGroup = "broken" | "approval" | "slipping";

/** One row of the per-site "Needs you" feed: every reason a single site needs the
 *  operator, combined. The feed is navigation-only — the row links once to the page. */
export type NeedsYouItem = {
  /** The site's worst category present — drives the dot, the group sub-label, and order. */
  group: NeedsYouGroup;
  /** Any of the site's broken items is `severity: "critical"` (within-broken ordering). */
  hasCritical: boolean;
  slug: string;
  siteName: string;
  reasons: string[];
  /** Always `/s/${slug}`. */
  url: string;
};

const NEEDS_YOU_GROUP_RANK: Record<NeedsYouGroup, number> = { broken: 0, approval: 1, slipping: 2 };

/**
 * Collapse the cockpit model into a per-site "Needs you" feed — ONE row per site,
 * with every reason combined. PURE. A vuln counts as broken only once Renovate's
 * auto-fix is exhausted (`item.autoFixExhausted`); while the fleet is still retrying
 * it, the site stays off the feed and off the verdict. Order: broken → approval →
 * slipping; within broken, critical-first; then site name.
 */
export function buildNeedsYouFeed(model: CockpitModel): NeedsYouItem[] {
  type Acc = {
    slug: string;
    siteName: string;
    reasons: string[];
    hasCritical: boolean;
    broken: boolean;
    approval: boolean;
    slipping: boolean;
  };
  const bySlug = new Map<string, Acc>();
  const get = (siteName: string): Acc => {
    const slug = siteSlug(siteName);
    let a = bySlug.get(slug);
    if (!a) {
      a = { slug, siteName, reasons: [], hasCritical: false, broken: false, approval: false, slipping: false };
      bySlug.set(slug, a);
    }
    return a;
  };

  for (const card of model.cards) {
    if (card.tier === "attention") {
      for (const item of card.items) {
        if (item.kind === "vuln" && item.autoFixExhausted !== true) continue; // the gate
        const a = get(card.site.name);
        a.reasons.push(item.title);
        a.broken = true;
        if (item.severity === "critical") a.hasCritical = true;
      }
    } else if (card.tier === "watch" && card.watchReasons.length > 0) {
      const a = get(card.site.name);
      for (const r of card.watchReasons) a.reasons.push(r);
      a.slipping = true;
    }
  }

  for (const p of model.pending) {
    const a = get(p.siteName);
    a.reasons.push(`${p.reportType} ${p.period} ready`);
    a.approval = true;
  }

  const items: NeedsYouItem[] = [];
  for (const a of bySlug.values()) {
    if (a.reasons.length === 0) continue;
    const group: NeedsYouGroup = a.broken ? "broken" : a.approval ? "approval" : "slipping";
    items.push({ group, hasCritical: a.hasCritical, slug: a.slug, siteName: a.siteName, reasons: a.reasons, url: `/s/${a.slug}` });
  }

  items.sort((x, y) => {
    if (NEEDS_YOU_GROUP_RANK[x.group] !== NEEDS_YOU_GROUP_RANK[y.group])
      return NEEDS_YOU_GROUP_RANK[x.group] - NEEDS_YOU_GROUP_RANK[y.group];
    if (x.group === "broken" && x.hasCritical !== y.hasCritical) return x.hasCritical ? -1 : 1;
    return x.siteName.toLowerCase().localeCompare(y.siteName.toLowerCase());
  });

  return items;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard/fleet-cockpit.test.ts -t buildNeedsYouFeed`
Expected: PASS (7 tests). Then run the whole file to confirm no regressions: `npx vitest run tests/dashboard/fleet-cockpit.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(dashboard): buildNeedsYouFeed — per-site cockpit feed with vuln-exhaustion gate"
```

---

## Task 3: Verdict bar (replaces summary bar + all-clear banner) + Audit relabel

**Files:**
- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

**Context:** `renderCockpitHtml` currently renders `summaryBar(model)` then `allClearBanner(model)`. This task replaces both with a single `verdictBar`, adds verdict CSS, and relabels the refresh button + its script reset strings from "Refresh" to "Audit". The `refresh-fleet` CSS class name is kept (only the visible text changes) so the existing `button.refresh-fleet` script selector still binds.

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("verdict bar", () => {
  it("shows All clear when nothing needs the operator", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).toContain("✓ All clear");
    expect(html).toContain("↻ Audit fleet");
    expect(html).not.toContain("needs attention</span>"); // old summary tally gone
  });
  it("shows the per-site need count when something is wrong", () => {
    const html = renderCockpitHtml(
      model([siteRow({ name: "Acme", securityVulnsCritical: 2, securityAutoFixAttempts: 4 })]),
    );
    expect(html).toMatch(/⚠ 1 site needs you/);
    expect(html).not.toContain("✓ All clear");
  });
});
```

Note: `securityAutoFixAttempts` is the field `collectVulnAlerts` reads to set `autoFixExhausted`. If `makeWebsiteRow` / `siteRow` does not yet accept it, pass whatever field name the row helper exposes for the auto-fix counter (grep `autoFixExhausted` / `Security Auto-Fix Attempts` in `src/alerts/digest-collectors.ts` and `src/reports/airtable/websites.ts` to confirm the `WebsiteRow` property name, and use that). The assertion that matters is `⚠ 1 site needs you`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts -t "verdict bar"`
Expected: FAIL — output still contains the old summary markup / "↻ Refresh fleet state", not the verdict.

- [ ] **Step 3: Add imports + `verdictBar`**

In `src/dashboard/fleet-render.ts`, extend the `fleet-cockpit.js` import:

```ts
import type { CockpitModel, SiteCard, Tier, SubmissionEntry, NeedsYouItem, NeedsYouGroup } from "./fleet-cockpit.js";
import { fleetLastAuditedAt, buildNeedsYouFeed } from "./fleet-cockpit.js";
```

Add the function (place it where `summaryBar` is):

```ts
/** The glance verdict: "✓ All clear", or "⚠ N sites need you". N is the per-site
 *  Needs-you feed length (NOT submissions). Houses the ↻ Audit button + live panel. */
function verdictBar(model: CockpitModel, feedCount: number): string {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const audited = auditedIso ? ` · fleet last audited ${escapeHtml(relativeTimeFromNow(auditedIso))}` : "";
  const sites = model.cards.length;
  const sitesWord = `${sites} site${sites === 1 ? "" : "s"}`;
  const actions = `<div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Audit fleet</button>
      <div id="rf-status" class="rf-status" aria-live="polite"></div>
    </div>`;
  if (feedCount === 0) {
    return `<div class="verdict ok">
      <div class="verdict-line">✓ All clear</div>
      <div class="verdict-meta">${sitesWord} healthy${audited}</div>
      ${actions}
    </div>`;
  }
  const noun = feedCount === 1 ? "site needs" : "sites need";
  return `<div class="verdict warn">
    <div class="verdict-line">⚠ ${feedCount} ${noun} you</div>
    <div class="verdict-meta">${sitesWord}${audited}</div>
    ${actions}
  </div>`;
}
```

- [ ] **Step 4: Wire it into `renderCockpitHtml`; delete `summaryBar` + `allClearBanner`**

In `renderCockpitHtml`, at the top of the function add `const feed = buildNeedsYouFeed(model);`. Replace the two body lines:

```ts
  ${summaryBar(model)}
  ${allClearBanner(model)}
```

with:

```ts
  ${verdictBar(model, feed.length)}
```

Then **delete** the now-unused `summaryBar` function and the `allClearBanner` function. (Leave `approveStrip`, the tier `sections`, `spamRollup`, `submissionsStrip` for later tasks.) The `FILTERS` const is still used by `summaryBar`'s removal — it is referenced by the chips; after deleting `summaryBar`, `FILTERS` becomes unused **in this file** but it moves to `fleet-browse-render.ts` in Task 5. To keep the build green now, leave the `FILTERS` declaration in place (it is still referenced by nothing → prefix with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` ONLY if lint complains; otherwise leave it — Task 5 removes it). Simplest: leave `FILTERS` untouched this task.

- [ ] **Step 5: Add verdict CSS; relabel the script strings**

In `STYLES`, add:

```css
.verdict { border-radius:8px; padding:0.9rem 1.1rem; margin-bottom:1.25rem; }
.verdict .verdict-line { font-weight:800; font-size:1.4rem; }
.verdict .verdict-meta { color:#666; font-size:0.9rem; margin-top:0.2rem; }
.verdict.ok { background:#e8f5e9; color:#1b7a2f; }
.verdict.ok .verdict-meta { color:#2e7d32; }
.verdict.warn { background:#fdecea; color:#b00; }
.verdict.warn .verdict-meta { color:#b00; opacity:0.85; }
@media (prefers-color-scheme: dark) { .verdict.ok { background:#10240f; color:#7fce85; } .verdict.warn { background:#2a0f0d; color:#ff8a80; } }
.verdict .fleet-actions { margin:0.6rem 0 0; }
```

In the inline script (`FILTER_SCRIPT`), relabel the three operator-facing strings:
- `'↻ Refresh fleet state'` → `'↻ Audit fleet'` (appears twice — both reset branches)
- `'↻ Refresh running…'` → `'↻ Audit running…'`
- `rf.textContent = 'Refreshing…';` → `rf.textContent = 'Auditing…';`

(Leave the `confirm(...)` copy as-is — it already describes the security + Lighthouse sweeps.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts`
Expected: the new "verdict bar" tests PASS. Some pre-existing tests that asserted the old summary tally / "Refresh fleet state" text / all-clear banner copy will FAIL — **update them**: replace assertions referencing `summaryBar` markup (`needs attention`, `Lighthouse<75`, the `.summary`/`.filters` tally) and the old `all-clear` banner with verdict assertions (`✓ All clear` / `⚠ N sites need you`), and `↻ Refresh fleet state` → `↻ Audit fleet`. Re-run until green. Keep test intent; only update the strings/markup that legitimately changed.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): cockpit verdict bar replaces the summary tally; relabel Refresh→Audit"
```

---

## Task 4: Needs-you feed (replaces the approve strip)

**Files:**
- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("needs-you feed", () => {
  it("renders one Open-only row per pending approval and no Approve button", () => {
    const sites = [siteRow({ name: "Acme" })];
    const reports = [pendingMaintenanceReport(sites[0])]; // see note
    const html = renderCockpitHtml(model(sites, reports));
    expect(html).toContain('href="/s/' + "acme" + '"');
    expect(html).toContain("Open ▸");
    expect(html).toContain("Waiting on your yes");
    expect(html).not.toContain("data-approve-url"); // approve action no longer on the home page
    expect(html).not.toContain(">Approve<");
  });
  it("omits the feed entirely when nothing needs the operator", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).not.toContain("Needs you (");
  });
});
```

Note: reuse whatever existing helper the test file already has for building a pending report row (grep the file for how other tests construct `reports` that become `model.pending` — there is already coverage of the approve strip; mirror its report fixture). If none exists, build a minimal `ReportRow` via the same helper those tests use and name it `pendingMaintenanceReport`. The assertions that matter: `Open ▸` present, `Waiting on your yes` present, no `data-approve-url`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts -t "needs-you feed"`
Expected: FAIL — output still has the approve strip (`data-approve-url`), no `Open ▸` feed.

- [ ] **Step 3: Add `renderNeedsYouFeed` + group labels**

In `src/dashboard/fleet-render.ts`:

```ts
const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  approval: "Waiting on your yes",
  slipping: "Slipping",
};

/** The single per-site triage feed. Every row is navigation-only: one Open ▸ to the
 *  site page (where approve / Trigger Renovate / checklist already live). */
function renderNeedsYouFeed(feed: NeedsYouItem[]): string {
  if (feed.length === 0) return "";
  const groups: NeedsYouGroup[] = ["broken", "approval", "slipping"];
  const blocks = groups
    .map((g) => {
      const rows = feed.filter((i) => i.group === g);
      if (rows.length === 0) return "";
      const lis = rows
        .map(
          (i) => `<div class="feed-row" data-group="${g}">
          <span class="dot ${g}"></span>
          <span class="feed-what"><strong>${escapeHtml(i.siteName)}</strong> — ${escapeHtml(i.reasons.join(" · "))}</span>
          <a class="feed-open" href="${escapeHtml(i.url)}">Open ▸</a>
        </div>`,
        )
        .join("");
      return `<div class="feed-group"><div class="feed-group-label">${NEEDS_YOU_GROUP_LABEL[g]}</div>${lis}</div>`;
    })
    .join("");
  return `<section class="needs-you"><h2>Needs you (${feed.length})</h2>${blocks}</section>`;
}
```

- [ ] **Step 4: Wire it in; delete `approveStrip` + the approve handler**

In `renderCockpitHtml`, replace `${approveStrip(model)}` with `${renderNeedsYouFeed(feed)}`. **Delete** the `approveStrip` function. In the inline script, **delete** the entire `// approve buttons:` block (the `document.querySelectorAll('button.approve')...` listener) — the home page no longer has approve buttons.

- [ ] **Step 5: Add feed CSS**

In `STYLES`, add:

```css
.needs-you { border:1px solid #e5e5e5; border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.25rem; }
@media (prefers-color-scheme: dark) { .needs-you { border-color:#2a2a2a; background:#181818; } }
.needs-you h2 { font-size:1.05rem; margin:0 0 0.5rem; }
.feed-group-label { text-transform:uppercase; letter-spacing:0.04em; font-size:0.72rem; color:#999; margin:0.6rem 0 0.2rem; }
.feed-row { display:flex; gap:0.5rem; align-items:center; padding:0.3rem 0; border-bottom:1px dashed #eee; }
.feed-row:last-child { border-bottom:0; }
@media (prefers-color-scheme: dark) { .feed-row { border-bottom-color:#262626; } }
.feed-what { flex:1; }
.feed-open { white-space:nowrap; }
.dot { width:0.55rem; height:0.55rem; border-radius:50%; display:inline-block; flex:0 0 auto; }
.dot.broken { background:#dc2626; }
.dot.approval { background:#2563eb; }
.dot.slipping { background:#f59e0b; }
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts`
Expected: new "needs-you feed" tests PASS. Update any pre-existing test that asserted approve-strip markup (`Approve (N) — your daily yes`, `data-approve-url`, `data-signal="pending"`) to the feed equivalents (`Needs you (`, `Waiting on your yes`, `Open ▸`). Re-run until green.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): per-site Needs-you feed replaces the approve strip (navigation-only)"
```

---

## Task 5: Extract the Fleet browse panel + fix the filter bug

**Files:**
- Create: `src/dashboard/fleet-browse-render.ts`
- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

**Context:** Move the card-grid rendering into a new module and present it as ONE collapsed `<details class="fleet-browse">` with the filter chips and a single flat `.cards` grid (no nested per-tier `<details>`). This is what fixes the filter-vs-collapsed-tier bug. The filter list drops `pending` and `submissions` (those are the feed and the inbox now). The refresh/live-status script stays in `fleet-render.ts` (renamed `AUDIT_SCRIPT`); the filter + trigger-renovate handlers move to `FLEET_BROWSE_SCRIPT`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("fleet browse panel", () => {
  it("renders one collapsed <details> with a single flat card grid (no nested tier details)", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" }), siteRow({ name: "Beta" })]));
    expect(html).toContain('<details class="fleet-browse">');
    expect(html).toContain("Fleet (2)");
    // exactly one card grid, and no per-tier <details> wrappers
    expect(html.match(/<div class="cards">/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('details class="tier"');
  });
  it("keeps the per-card Trigger Renovate button for repo-backed sites", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme", gitRepo: "reddoorla/acme" })]));
    expect(html).toContain("trigger-renovate");
  });
  it("offers signal filters but not pending/submissions", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).toContain('data-filter="vulns"');
    expect(html).not.toContain('data-filter="pending"');
    expect(html).not.toContain('data-filter="submissions"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts -t "fleet browse panel"`
Expected: FAIL — still three `details.tier` sections, `data-filter="pending"` present.

- [ ] **Step 3: Create `src/dashboard/fleet-browse-render.ts`**

Move these from `fleet-render.ts` into the new file (cut them out of `fleet-render.ts`): `scoreSpan`, `a11ySpan`, `depsSpan`, `securitySpan`, `card`, `PILL_LABEL`, `attentionBadge`, `chips`, `signalsAttr`, `triggerRenovateBtn`, `submBadge`, `cockpitCard`. Add the panel renderer, the trimmed filter list, and the browse script. Full new file:

```ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { CockpitModel, SiteCard, Tier } from "./fleet-cockpit.js";
import { onboardingStatus, missingOnboarding } from "./onboarding.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

const DASH = "—";

// --- moved verbatim from fleet-render.ts: scoreSpan, a11ySpan, depsSpan, securitySpan,
//     card, PILL_LABEL, attentionBadge, chips, signalsAttr, triggerRenovateBtn, submBadge,
//     cockpitCard. (Paste them here unchanged.) ---

/** Signal filters for the Fleet panel — the card-derived tags only. `pending` lives in
 *  the Needs-you feed and `submissions` in the Inbox lane, so they are not card filters. */
const FLEET_FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "auto-fix-failed",
  "stale",
  "no-domain",
] as const;

/** The fleet browser: one collapsed <details> holding the filter chips and a single
 *  flat card grid (cards already ordered attention→watch→healthy by buildCockpitModel).
 *  Flattening — no nested per-tier <details> — is what makes the filters actually work:
 *  a filtered card can never hide inside a collapsed tier. */
export function renderFleetBrowsePanel(model: CockpitModel): string {
  const total = model.cards.length;
  const chips = FLEET_FILTERS.map(
    (f) =>
      `<button type="button" data-filter="${f}" aria-pressed="${f === "all" ? "true" : "false"}">${f}</button>`,
  ).join("");
  const body =
    total === 0
      ? `<div class="empty">No sites on the fleet view yet.</div>`
      : `<div class="cards">${model.cards.map(cockpitCard).join("")}</div>`;
  return `<details class="fleet-browse">
    <summary>Fleet (${total})</summary>
    <div class="filters">${chips}</div>
    ${body}
  </details>`;
}

/** Client behavior scoped to the Fleet panel: tag-based card filtering + the per-card
 *  Trigger Renovate dispatch. String-concat only (lives inside a TS template literal). */
export const FLEET_BROWSE_SCRIPT = `<script>
(function(){
  var btns = document.querySelectorAll('.fleet-browse .filters button');
  var cards = document.querySelectorAll('.fleet-browse .cards .card');
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      var f = b.getAttribute('data-filter');
      btns.forEach(function(x){ x.setAttribute('aria-pressed', x===b ? 'true':'false'); });
      cards.forEach(function(c){
        var sig = (c.getAttribute('data-signals')||'').split(' ');
        c.style.display = (f==='all' || sig.indexOf(f)!==-1) ? '' : 'none';
      });
    });
  });
  document.querySelectorAll('.fleet-browse button.trigger-renovate').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Dispatching…';
      try { var res = await fetch(b.dataset.triggerUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Dispatched ✓' : 'Failed';
        if (!res.ok) b.disabled = false; }
      catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
})();
</script>`;
```

When you paste the moved helpers, the only one that references a removed local is `card` (uses `DASH`, `onboardingStatus`, etc. — all imported above) and `cockpitCard` (uses `card`, `PILL_LABEL`, `chips`, `submBadge`, `triggerRenovateBtn`, `signalsAttr` — all in this file). No edits to their bodies are needed.

- [ ] **Step 4: Update `fleet-render.ts`**

- Remove the helpers you moved (they now live in `fleet-browse-render.ts`) and the now-unused `DASH` const, `FILTERS` const, `TIER_META` const, and the `siteSlug`, `onboardingStatus`, `missingOnboarding`, `safeUrl`, `WebsiteRow` imports **only if** nothing else in `fleet-render.ts` still uses them (grep before deleting; `escapeHtml`, `relativeTimeFromNow`, `SiteCard`, `Tier`, `SubmissionEntry`, `CockpitModel` are still used).
- Add import: `import { renderFleetBrowsePanel, FLEET_BROWSE_SCRIPT } from "./fleet-browse-render.js";`
- In `renderCockpitHtml`, delete the `tiers`/`sections` block (the `.map` building the three `<details class="tier">`) and replace `${sections}` in the body with `${renderFleetBrowsePanel(model)}`.
- Rename the remaining inline script: the leftover `FILTER_SCRIPT` now contains ONLY the `rf*` refresh/audit-follow logic (the filter block and trigger-renovate block moved to `FLEET_BROWSE_SCRIPT`; the approve block was deleted in Task 4). Rename the const `FILTER_SCRIPT` → `AUDIT_SCRIPT`, and **delete** from it the `var btns = document.querySelectorAll('.filters button')...` filter block and the `document.querySelectorAll('button.trigger-renovate')...` block. Keep everything from `var RF_KEY` through the end of the IIFE.
- In the body, the scripts line becomes: `${AUDIT_SCRIPT}\n  ${FLEET_BROWSE_SCRIPT}`.

- [ ] **Step 5: Move the tier/filter CSS appropriately**

In `STYLES` (still in `fleet-render.ts`): **delete** `details.tier` and `details.tier > summary` rules. **Add** a rule for the new panel summary:

```css
details.fleet-browse > summary, details.inbox > summary { cursor:pointer; font-weight:700; font-size:1.05rem; padding:0.35rem 0; list-style:none; }
details.fleet-browse, details.inbox { margin:0.75rem 0; }
```

(`.filters`, `.cards`, `.card*`, `.chip*`, `.pill*`, `.empty` rules stay — the browse panel still uses them.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts` then `npx vitest run tests/dashboard/cockpit-submissions.test.ts tests/dashboard/fleet-render-submissions.test.ts`
Expected: the "fleet browse panel" tests PASS. Update any test asserting `details.tier` / tier summaries (`🔴 Needs attention`) to the flat panel (`Fleet (N)`, `details.fleet-browse`). Then `npx tsc --noEmit` to confirm no dangling imports.
Re-run until green.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts src/dashboard/fleet-browse-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "refactor(dashboard): extract fleet-browse-render; flatten cards so filters work"
```

---

## Task 6: Inbox lane (submissions + spam, collapsed)

**Files:**
- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`, `tests/dashboard/cockpit-submissions.test.ts`

**Context:** Fold `spamRollup` + `submissionsStrip` into one collapsed `<details class="inbox">`. Submissions never affect the verdict. Keep the newest-10 cap and the "View all" link.

- [ ] **Step 1: Write the failing tests**

```ts
describe("inbox lane", () => {
  it("renders submissions + spam inside one collapsed details, below the fleet panel", () => {
    const sites = [siteRow({ name: "Acme" })];
    const subs = [submissionFixture(sites[0])]; // reuse the existing submissions test helper
    const html = renderCockpitHtml(modelWithSubs(sites, subs)); // see note
    expect(html).toContain('<details class="inbox">');
    expect(html).toContain("📥 Submissions (1 new)");
    expect(html).toContain('href="/submissions"');
    const inboxIdx = html.indexOf('class="inbox"');
    const fleetIdx = html.indexOf('class="fleet-browse"');
    expect(fleetIdx).toBeGreaterThan(-1);
    expect(inboxIdx).toBeGreaterThan(fleetIdx); // inbox comes after the fleet panel
  });
  it("omits the inbox entirely with no submissions and no spam", () => {
    const html = renderCockpitHtml(model([siteRow({ name: "Acme" })]));
    expect(html).not.toContain('class="inbox"');
  });
});
```

Note: `tests/dashboard/cockpit-submissions.test.ts` already builds a model with submissions (and `fleet-render-submissions.test.ts`). Reuse its exact helper for `submissionFixture` / building a model with `submissions` populated (grep that file for how it calls `buildCockpitModel` with the `newSubmissions` argument, and mirror it as `modelWithSubs`). The assertions that matter: `<details class="inbox">`, `📥 Submissions (1 new)`, ordering after the fleet panel.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts -t "inbox lane"`
Expected: FAIL — submissions still render as the old `.approve-strip subm-strip`, spam as a bare `.spam-rollup`, no `.inbox` details.

- [ ] **Step 3: Replace `spamRollup` + `submissionsStrip` with `renderInboxLane`**

Delete the `spamRollup` and `submissionsStrip` functions. Keep `SUBMISSIONS_STRIP_CAP`. Add:

```ts
/** The quiet inbox lane: newest submissions + the 30-day spam roll-up, in one collapsed
 *  <details>. Submissions are a separate work stream — they never raise the verdict. */
function renderInboxLane(model: CockpitModel): string {
  const subs: SubmissionEntry[] = model.submissions ?? [];
  const spam = model.spam;
  const hasSpam = !!spam && (spam.caught > 0 || spam.through > 0);
  if (subs.length === 0 && !hasSpam) return "";

  const shown = [...subs]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_STRIP_CAP);
  const rows = shown
    .map((sub) => {
      const href = `/s/${escapeHtml(sub.slug)}`;
      const when = sub.submittedAt ? escapeHtml(relativeTimeFromNow(sub.submittedAt)) : "";
      const who = escapeHtml(sub.name || sub.email);
      return `<div class="approve-row" data-signal="submissions">
        <strong>${escapeHtml(sub.siteName)}</strong>
        <span class="muted">${escapeHtml(sub.formType)} — ${who}</span>
        <span class="muted">${when}</span>
        <a href="${href}">open ▸</a>
      </div>`;
    })
    .join("");
  const overflow = subs.length - shown.length;
  const more =
    overflow > 0
      ? `<div class="approve-row subm-more muted"><a href="/submissions">+${overflow} more — view all submissions</a></div>`
      : `<div class="approve-row subm-more muted"><a href="/submissions">View all submissions →</a></div>`;
  const spamLine = hasSpam
    ? `<div class="spam-rollup muted">🛡 Spam (30d) — caught ${spam!.caught} · through ${spam!.through}</div>`
    : "";
  const spamInSummary = hasSpam ? " · 🛡 Spam (30d)" : "";
  return `<details class="inbox">
    <summary>📥 Submissions (${subs.length} new)${spamInSummary}</summary>
    ${rows}${subs.length > 0 ? more : ""}
    ${spamLine}
  </details>`;
}
```

- [ ] **Step 4: Wire it into `renderCockpitHtml`**

Replace the trailing `${spamRollup(model)}` and `${submissionsStrip(model)}` lines with a single `${renderInboxLane(model)}`, placed AFTER `${renderFleetBrowsePanel(model)}` and BEFORE the scripts. Final body order:

```ts
  ${verdictBar(model, feed.length)}
  ${renderNeedsYouFeed(feed)}
  ${renderFleetBrowsePanel(model)}
  ${renderInboxLane(model)}
  ${AUDIT_SCRIPT}
  ${FLEET_BROWSE_SCRIPT}
```

- [ ] **Step 5: Prune dead CSS**

In `STYLES`, delete the now-unused `.approve-strip` and `.all-clear` rules (and `.summary`, `.summary .tier`, `.summary .heads` if not already removed in Task 3). Keep `.approve-row`, `.muted`, `.subm-viewall`, `.subm-more`, `.spam-rollup` (the inbox rows reuse them).

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/dashboard/fleet-render.test.ts tests/dashboard/cockpit-submissions.test.ts tests/dashboard/fleet-render-submissions.test.ts`
Expected: "inbox lane" tests PASS. Update prior submission/spam tests that asserted the old `.approve-strip subm-strip` heading (`📥 New submissions (N)`) or bare `.spam-rollup` placement to the inbox lane (`<details class="inbox">`, `📥 Submissions (N new)`). Re-run until green.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts tests/dashboard/cockpit-submissions.test.ts tests/dashboard/fleet-render-submissions.test.ts
git commit -m "feat(dashboard): collapse submissions + spam into one quiet Inbox lane"
```

---

## Task 7: Changeset + full verification gate

**Files:**
- Create: `.changeset/cockpit-reorg-needs-you-feed.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/cockpit-reorg-needs-you-feed.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Dashboard: reorganize the fleet cockpit around "check nothing's on fire". A glance
verdict (✓ All clear / ⚠ N sites need you) leads the page, followed by a single
per-site, navigation-only "Needs you" feed (Broken → Waiting on your yes → Slipping;
every row opens the site page). The fleet card browser and the submissions/spam inbox
move into collapsed lanes, and the card filters now work (one flat grid, no nested
collapsed tiers). Vulns only enter the feed once Renovate's auto-fix is exhausted, so
the verdict can read All clear while the fleet patches in the background. The fleet
sweep button is relabeled Refresh → Audit.
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:dist
```

Expected: all pass. `pnpm lint` runs `eslint . && prettier --check .` — if prettier flags formatting, run `npx prettier --write src/dashboard/fleet-render.ts src/dashboard/fleet-browse-render.ts src/dashboard/fleet-cockpit.ts tests/dashboard/*.ts .changeset/cockpit-reorg-needs-you-feed.md` and re-run. `pnpm typecheck` covers both `tsconfig` and `tsconfig.netlify.json` (the `.mts` caller).

- [ ] **Step 3: Manual sanity check of the rendered HTML (optional but recommended)**

```bash
npx tsx -e "import('./src/dashboard/fleet-render.js').then(m=>{}).catch(e=>console.error(e))"
```

If a quick visual is wanted, render a model in a scratch script and eyeball the section order (verdict → needs-you → fleet-browse → inbox). Not required for correctness (tests cover structure).

- [ ] **Step 4: Commit**

```bash
git add .changeset/cockpit-reorg-needs-you-feed.md
# include any prettier-only fixups from Step 2:
git add -p src/dashboard tests/dashboard 2>/dev/null || true
git commit -m "chore(changeset): cockpit reorg — verdict + needs-you feed"
```

---

## Self-review (author check against the spec)

**Spec coverage:**
- Verdict bar (count = per-site feed length, excl. submissions; All clear vs N sites need you; last-audited line; Audit button) → Task 3. ✓
- Per-site Needs-you feed, navigation-only, groups + ordering, vuln-exhaustion gate → Tasks 2 + 4. ✓
- Fleet panel collapsed, flattened grid (filter bug fix), keeps per-card Trigger Renovate, drops pending/submissions filters → Task 5. ✓
- Inbox lane collapsed (submissions + spam), submissions excluded from verdict → Task 6. ✓
- Refresh → Audit relabel → Task 3. ✓
- `fleetLastAuditedAt` → Task 1. ✓
- File split into `fleet-browse-render.ts` → Task 5. ✓
- Changeset (minor), full gate incl. `test:dist` → Task 7. ✓
- Out of scope (no endpoints, no schema, per-site page untouched) respected — no task touches `netlify/functions/*` or Airtable. ✓

**Type/name consistency:** `NeedsYouGroup` / `NeedsYouItem` / `buildNeedsYouFeed` / `fleetLastAuditedAt` (fleet-cockpit.ts) used identically in fleet-render.ts; `renderFleetBrowsePanel` / `FLEET_BROWSE_SCRIPT` / `FLEET_FILTERS` (fleet-browse-render.ts); `verdictBar` / `renderNeedsYouFeed` / `renderInboxLane` / `AUDIT_SCRIPT` / `NEEDS_YOU_GROUP_LABEL` (fleet-render.ts). Section body order is stated identically in Tasks 5 and 6. ✓

**Placeholders:** none — each code step ships complete code; the two "reuse the existing test helper" notes point at concrete existing files/fixtures rather than leaving logic unspecified.
