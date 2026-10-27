# M4 Cockpit — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fleet homepage (`/`) into a triage cockpit — sites grouped into 🔴/🟡/🟢 health tiers (cards), an approve queue pinned on top, the M5 attention signals shown per site with NEW/WORSE badges that match the daily email — rendered entirely from already-persisted Airtable state.

**Architecture:** A new pure core (`src/dashboard/fleet-cockpit.ts`, `buildCockpitModel`) runs the existing M5 collectors over the visible sites, tags each item NEW/WORSE via the existing `diffAttention` (read-only — never written back), assigns each site a tier, and produces a render-ready `CockpitModel`. The renderer (`src/dashboard/fleet-render.ts`, `renderCockpitHtml`) turns that model into one HTML document — summary bar + filter chips + approve strip + three `<details>` tier sections of cards — reusing the existing card/escaping helpers. The Netlify handler (`netlify/functions/fleet-homepage.mts`) fetches Websites + Reports + the Digest State snapshot once (each defensively), builds the model, renders, and is rate-limited.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest (`pnpm test`), Netlify Functions, Airtable. No new dependencies. Native `<details>`/`<summary>` for collapse; ~20 lines inline vanilla JS for filtering and the approve fetch.

**Reference reading (already-built seams this plan reuses):**

- `src/alerts/digest-collectors.ts` — `collectVulnAlerts(sites, baseUrl)`, `collectLighthouseAlerts(sites, baseUrl)`, `collectDeliveryFailures(reports, sitesById, baseUrl)`. Pure, return `AttentionItem[]`. `LIGHTHOUSE_FLOOR = 75`.
- `src/alerts/digest-state.ts` — `type DigestSnapshot`, `diffAttention(items, prior, today) → { tagged, next }`, `readDigestState(base)`.
- `src/reports/digest.ts` — `type AttentionItem` (`key`, `kind`, `siteName`, `title`, `url?`, `severity`, `metric`, `status?`), `listPendingApproval` (the pending predicate: `draftReady ∧ !approvedToSend ∧ sentAt === null`).
- `src/reports/airtable/websites.ts` — `WebsiteRow`, `siteSlug(name)`, `listWebsites(base)`. Tier-relevant fields: `pScore/rScore/bpScore/seoScore` (null = never audited), `securityVulnsCritical/High`, `lastLighthouseAuditAt`, `dashboardToken` (null = hidden from `/`), `name`, `id`, `url`.
- `src/reports/airtable/reports.ts` — `ReportRow` (`id`, `siteId`, `reportType`, `period: string|null`, `draftReady`, `approvedToSend`, `sentAt`, `deliveryStatus`), `listAllReports(base)`.
- `src/dashboard/fleet-render.ts` — existing `card(site)`, `escapeHtml`, `safeUrl`, `scoreSpan`/`a11ySpan`/`depsSpan`/`securitySpan`, `STYLES`, current `renderFleetHomeHtml(sites, pending)`.
- `src/dashboard/relative-time.ts` — `relativeTimeFromNow(iso, now)`.
- `src/dashboard/onboarding.ts` — `onboardingStatus(row)`.
- `src/dashboard/render.ts:71` — the existing approve-button markup: `<button class="approve" data-report-id="..." data-approve-url="/api/reports/<id>/approve">Approve</button>` + the `fetch(b.dataset.approveUrl,{method:"POST"})` handler pattern to mirror.

**Out of scope (slice 2, separate plan):** Renovate-failing / CI-red / last-deploy signals (need cron-persisted Airtable fields first).

---

## File Structure

- **Create** `src/dashboard/fleet-cockpit.ts` — the pure core: `Tier`, `SiteCard`, `PendingEntry`, `CockpitSummary`, `CockpitModel`, `assignTier`, `buildCockpitModel`. No IO, no `Date.now()` except via an injected `now`.
- **Create** `tests/dashboard/fleet-cockpit.test.ts` — exhaustive unit tests for the core.
- **Modify** `src/dashboard/fleet-render.ts` — replace `renderFleetHomeHtml(sites, pending)` with `renderCockpitHtml(model: CockpitModel)`; keep/extend the card + style helpers; add summary bar, filter chips, approve strip, tier sections, inline JS.
- **Modify** `tests/dashboard/fleet-render.test.ts` — migrate to the new `renderCockpitHtml(model)` signature; keep the card/escaping assertions, replace the pending-banner block with approve-strip + tier assertions.
- **Modify** `src/dashboard/index.ts` — export `renderCockpitHtml` (+ the cockpit types) instead of `renderFleetHomeHtml`.
- **Modify** `netlify/functions/fleet-homepage.mts` — fetch Reports + Digest State (defensive), build the model, render; add the rate-limit `Config`.

---

## Task 1: The pure core — tier assignment

**Files:**

- Create: `src/dashboard/fleet-cockpit.ts`
- Test: `tests/dashboard/fleet-cockpit.test.ts`

- [ ] **Step 1: Write the failing test for `assignTier`**

Create `tests/dashboard/fleet-cockpit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AttentionItem } from "../../src/reports/digest.js";

const NOW = new Date("2026-06-11T12:00:00Z");

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: "t@x.com",
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastLighthouseAuditAt: "2026-06-10T12:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    depsOutdated: null,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    dashboardToken: "tok",
    ...over,
  };
}

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:recSITE",
    kind: "vuln",
    siteName: "Acme Co",
    title: "1 critical/high vuln",
    severity: "critical",
    metric: 1,
    ...over,
  };
}

describe("assignTier", () => {
  it("is 'attention' when the site has any attention item", () => {
    const r = assignTier(site(), [item()], NOW);
    expect(r.tier).toBe("attention");
    expect(r.watchReasons).toEqual([]);
  });

  it("is 'watch' on a Lighthouse score in [75,85) with no attention items", () => {
    const r = assignTier(site({ pScore: 80 }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toContain("Performance 80");
  });

  it("is 'watch' when the last audit is older than 30 days", () => {
    const r = assignTier(site({ lastLighthouseAuditAt: "2026-04-01T00:00:00Z" }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons.some((s) => /ago/.test(s))).toBe(true);
  });

  it("does NOT treat a never-audited (null) site as audit-stale", () => {
    const r = assignTier(site({ lastLighthouseAuditAt: null }), [], NOW);
    expect(r.tier).toBe("healthy");
  });

  it("is 'healthy' when clean and recently audited", () => {
    expect(assignTier(site(), [], NOW).tier).toBe("healthy");
  });

  it("a score below the floor (handled as an attention item) is NOT double-counted as watch", () => {
    // pScore 60 would be an attention item upstream; assignTier sees the item → attention.
    const r = assignTier(
      site({ pScore: 60 }),
      [item({ kind: "lighthouse", severity: "warning" })],
      NOW,
    );
    expect(r.tier).toBe("attention");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- fleet-cockpit`
Expected: FAIL — "Failed to resolve import ... fleet-cockpit.js" / `assignTier is not a function`.

- [ ] **Step 3: Implement `assignTier` (minimal core file)**

Create `src/dashboard/fleet-cockpit.ts`:

```ts
// src/dashboard/fleet-cockpit.ts
import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { AttentionItem } from "../reports/digest.js";
import { relativeTimeFromNow } from "./relative-time.js";

export type Tier = "attention" | "watch" | "healthy";

/** Watch-tier thresholds (the soft band beneath the M5 alert floor). */
const LIGHTHOUSE_FLOOR = 75; // mirrors collectLighthouseAlerts — at/above is not an attention item
const LIGHTHOUSE_WATCH_HIGH = 85; // [75,85) = "near the floor" → watch
const AUDIT_STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WATCH_CATEGORIES: ReadonlyArray<{
  field: "pScore" | "rScore" | "bpScore" | "seoScore";
  label: string;
}> = [
  { field: "pScore", label: "Performance" },
  { field: "rScore", label: "Accessibility" },
  { field: "bpScore", label: "Best Practices" },
  { field: "seoScore", label: "SEO" },
];

/**
 * Tier a single site from its attention items + soft watch rules. PURE; `now` is
 * injected for testability. Any attention item → 🔴 attention (items already encode
 * the M5 thresholds, so a sub-75 Lighthouse score arrives here as an item and never
 * needs the watch band). Otherwise 🟡 watch when a Lighthouse category sits in
 * [75,85) or the last audit is older than 30 days (a NULL audit is NOT stale — it's
 * an onboarding gap, surfaced by the Setup score, not a regression). Else 🟢 healthy.
 */
export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): { tier: Tier; watchReasons: string[] } {
  if (items.length > 0) return { tier: "attention", watchReasons: [] };

  const watchReasons: string[] = [];
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      watchReasons.push(`${cat.label} ${score}`);
    }
  }
  if (site.lastLighthouseAuditAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastLighthouseAuditAt);
    if (Number.isFinite(ageMs) && ageMs > AUDIT_STALE_DAYS * MS_PER_DAY) {
      watchReasons.push(`audited ${relativeTimeFromNow(site.lastLighthouseAuditAt, now)}`);
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons }
    : { tier: "healthy", watchReasons: [] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-cockpit`
Expected: PASS (6 assertions in the `assignTier` block).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(cockpit): assignTier — health-tier rule for the M4 cockpit"
```

---

## Task 2: The pure core — `buildCockpitModel`

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts`
- Test: `tests/dashboard/fleet-cockpit.test.ts`

- [ ] **Step 1: Write the failing tests for `buildCockpitModel`**

Append to `tests/dashboard/fleet-cockpit.test.ts`:

```ts
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";

const BASE = "https://reddoor-maintenance.netlify.app";

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recRPT",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-05",
    periodStart: null,
    periodEnd: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    deliveryStatus: "pending",
  } as ReportRow;
}

describe("buildCockpitModel", () => {
  it("only includes dashboardToken-visible sites", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Visible", dashboardToken: "t" }),
        site({ id: "b", name: "Hidden", dashboardToken: null }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.site.name)).toEqual(["Visible"]);
  });

  it("tiers a vuln site as attention and a clean site as healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Bad", securityVulnsCritical: 2, securityVulnsHigh: 1 }),
        site({ id: "b", name: "Good" }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const bad = m.cards.find((c) => c.site.name === "Bad")!;
    const good = m.cards.find((c) => c.site.name === "Good")!;
    expect(bad.tier).toBe("attention");
    expect(bad.items).toHaveLength(1);
    expect(good.tier).toBe("healthy");
    expect(m.summary).toMatchObject({ attention: 1, healthy: 1, criticalHighVulns: 3 });
  });

  it("tags items NEW/WORSE from the prior snapshot but never returns a written snapshot", () => {
    const prior: DigestSnapshot = { "vuln:a": { metric: 1, firstFlaggedAt: "2026-06-01" } };
    const m = buildCockpitModel(
      [site({ id: "a", name: "Bad", securityVulnsCritical: 3, securityVulnsHigh: 0 })], // metric 3 > prior 1
      [],
      prior,
      BASE,
      NOW,
    );
    expect(m.cards[0]!.items[0]!.status).toBe("worse");
    // model has no `next`/snapshot field — read-only contract
    expect((m as Record<string, unknown>).next).toBeUndefined();
  });

  it("sorts attention worst-first: critical before warning, then higher total metric", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "WarnOnly", securityVulnsCritical: 0, securityVulnsHigh: 5 }),
        site({ id: "b", name: "CritLow", securityVulnsCritical: 1, securityVulnsHigh: 0 }),
        site({ id: "c", name: "CritHigh", securityVulnsCritical: 4, securityVulnsHigh: 0 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const attn = m.cards.filter((c) => c.tier === "attention").map((c) => c.site.name);
    expect(attn).toEqual(["CritHigh", "CritLow", "WarnOnly"]);
  });

  it("orders tiers attention → watch → healthy, alphabetical within watch/healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "h2", name: "Zeta" }),
        site({ id: "h1", name: "Alpha" }),
        site({ id: "w", name: "Mid", pScore: 80 }),
        site({ id: "a", name: "Bad", securityVulnsCritical: 1 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.tier)).toEqual(["attention", "watch", "healthy", "healthy"]);
    expect(m.cards.map((c) => c.site.name)).toEqual(["Bad", "Mid", "Alpha", "Zeta"]);
  });

  it("builds pending entries from draft-ready∧¬approved∧¬sent reports, resolving the site name", () => {
    const m = buildCockpitModel(
      [site({ id: "recSITE", name: "Acme Co" })],
      [
        report({ id: "r1", siteId: "recSITE", period: "2026-05" }),
        report({ id: "r2", siteId: "recSITE", approvedToSend: true }), // already approved → excluded
        report({ id: "r3", siteId: "recSITE", sentAt: "2026-05-02" }), // already sent → excluded
      ],
      {},
      BASE,
      NOW,
    );
    expect(m.pending).toEqual([
      {
        reportId: "r1",
        siteName: "Acme Co",
        slug: "acme-co",
        reportType: "Maintenance",
        period: "2026-05",
      },
    ]);
    expect(m.summary.pending).toBe(1);
  });

  it("counts lighthouse-below-floor and delivery failures in the summary", () => {
    const m = buildCockpitModel(
      [site({ id: "a", name: "Slow", pScore: 60, bpScore: 50 })],
      [report({ id: "rb", siteId: "a", deliveryStatus: "bounced" })],
      {},
      BASE,
      NOW,
    );
    expect(m.summary.lighthouseBelowFloor).toBe(2); // pScore + bpScore both < 75
    expect(m.summary.deliveryFailures).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- fleet-cockpit`
Expected: FAIL — `buildCockpitModel is not a function`.

- [ ] **Step 3: Implement `buildCockpitModel`**

Append to `src/dashboard/fleet-cockpit.ts` (add imports at the top):

```ts
import type { ReportRow, ReportType } from "../reports/airtable/reports.js";
import { siteSlug } from "../reports/airtable/websites.js";
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
} from "../alerts/digest-collectors.js";
import { diffAttention, type DigestSnapshot } from "../alerts/digest-state.js";
```

```ts
export type SiteCard = {
  site: WebsiteRow;
  tier: Tier;
  /** This site's tagged attention items (status already set), critical-first. */
  items: AttentionItem[];
  /** Why the site is on Watch (empty unless tier === "watch"). */
  watchReasons: string[];
};

export type PendingEntry = {
  reportId: string;
  siteName: string;
  slug: string;
  reportType: ReportType;
  period: string;
};

export type CockpitSummary = {
  attention: number;
  watch: number;
  healthy: number;
  criticalHighVulns: number;
  lighthouseBelowFloor: number;
  deliveryFailures: number;
  pending: number;
};

export type CockpitModel = {
  summary: CockpitSummary;
  /** All visible sites, ordered: attention (worst-first) → watch (A-Z) → healthy (A-Z). */
  cards: SiteCard[];
  pending: PendingEntry[];
};

const SEVERITY_RANK: Record<AttentionItem["severity"], number> = { critical: 0, warning: 1 };
const TIER_RANK: Record<Tier, number> = { attention: 0, watch: 1, healthy: 2 };

/**
 * Assemble the render-ready cockpit model from already-fetched Airtable rows. PURE
 * (`now` injected). Filters to dashboardToken-visible sites, runs the M5 collectors
 * over them, tags NEW/WORSE via diffAttention against the prior digest snapshot
 * (READ-ONLY — the returned `next` is discarded; only the daily digest writes state),
 * tiers each site, computes the summary, and resolves the pending-approval list.
 */
export function buildCockpitModel(
  websites: WebsiteRow[],
  reports: ReportRow[],
  priorSnapshot: DigestSnapshot,
  baseUrl: string,
  now: Date,
): CockpitModel {
  const visible = websites.filter((w) => w.dashboardToken !== null);
  const sitesById = new Map<string, WebsiteRow>(visible.map((w) => [w.id, w]));

  const rawItems: AttentionItem[] = [
    ...collectVulnAlerts(visible, baseUrl),
    ...collectLighthouseAlerts(visible, baseUrl),
    ...collectDeliveryFailures(reports, sitesById, baseUrl),
  ];
  // Read-only diff: tag NEW/WORSE exactly as the email does; discard `next`.
  const { tagged } = diffAttention(rawItems, priorSnapshot, now.toISOString().slice(0, 10));

  const bySite = new Map<string, AttentionItem[]>();
  for (const it of tagged) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }

  const cards: SiteCard[] = visible.map((site) => {
    const items = (bySite.get(site.name) ?? []).sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
    const { tier, watchReasons } = assignTier(site, items, now);
    return { site, tier, items, watchReasons };
  });

  cards.sort((a, b) => {
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (a.tier === "attention") {
      const sevA = a.items.some((i) => i.severity === "critical") ? 0 : 1;
      const sevB = b.items.some((i) => i.severity === "critical") ? 0 : 1;
      if (sevA !== sevB) return sevA - sevB;
      const metA = a.items.reduce((s, i) => s + i.metric, 0);
      const metB = b.items.reduce((s, i) => s + i.metric, 0);
      if (metA !== metB) return metB - metA;
    }
    return a.site.name.toLowerCase().localeCompare(b.site.name.toLowerCase());
  });

  const pending: PendingEntry[] = [];
  // Mirror listPendingApproval's predicate. Resolve against ALL websites (a pending
  // approval is never dropped just because the site is hidden from the fleet view).
  const allById = new Map<string, WebsiteRow>(websites.map((w) => [w.id, w]));
  for (const r of reports) {
    if (!(r.draftReady && !r.approvedToSend && r.sentAt === null)) continue;
    const s = allById.get(r.siteId);
    if (!s) continue; // orphan → skip rather than render a broken link
    pending.push({
      reportId: r.id,
      siteName: s.name,
      slug: siteSlug(s.name),
      reportType: r.reportType,
      period: r.period ?? "—",
    });
  }

  const summary: CockpitSummary = {
    attention: cards.filter((c) => c.tier === "attention").length,
    watch: cards.filter((c) => c.tier === "watch").length,
    healthy: cards.filter((c) => c.tier === "healthy").length,
    criticalHighVulns: tagged.filter((i) => i.kind === "vuln").reduce((s, i) => s + i.metric, 0),
    lighthouseBelowFloor: tagged.filter((i) => i.kind === "lighthouse").length,
    deliveryFailures: tagged.filter((i) => i.kind === "delivery").length,
    pending: pending.length,
  };

  return { summary, cards, pending };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-cockpit`
Expected: PASS (all `assignTier` + `buildCockpitModel` blocks green).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (If `ReportType` isn't re-exported from `reports.ts`, import it from `../reports/types.js` instead — confirm the export site.)

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(cockpit): buildCockpitModel — tiered, badged, sorted fleet model"
```

---

## Task 3: The renderer — document shell, summary bar, filter chips

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

This task replaces the public render entry point. `renderFleetHomeHtml(sites, pending)` becomes `renderCockpitHtml(model: CockpitModel)`. Keep all existing private helpers (`card`, `escapeHtml`, `safeUrl`, the `*Span` helpers, `STYLES`).

- [ ] **Step 1: Migrate the existing test file to the new signature + add summary-bar tests**

Replace the top of `tests/dashboard/fleet-render.test.ts` imports and add a model factory; keep the `siteRow` factory as-is. Add:

```ts
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";

const BASE = "https://reddoor-maintenance.netlify.app";
const NOW = new Date("2026-06-11T12:00:00Z");

/** Build a real model from site rows so render tests exercise the true shape. */
function model(
  sites: Parameters<typeof buildCockpitModel>[0],
  reports: Parameters<typeof buildCockpitModel>[1] = [],
) {
  return buildCockpitModel(sites, reports, {}, BASE, NOW);
}
```

Update the existing `describe("renderFleetHomeHtml — document shell")` block (and the others) to call `renderCockpitHtml(model([siteRow()]))` instead of `renderFleetHomeHtml([siteRow()])`. The card/escaping/metrics assertions stay valid (cards still render scores/a11y/deps/sec). Then add:

```ts
describe("renderCockpitHtml — summary bar", () => {
  it("shows the three tier counts", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1 }),
        siteRow({ id: "w", name: "Mid", pScore: 80 }),
        siteRow({ id: "g", name: "Good" }),
      ]),
    );
    expect(html).toMatch(/1[^<]*needs attention/i);
    expect(html).toMatch(/1[^<]*watch/i);
    expect(html).toMatch(/1[^<]*healthy/i);
  });

  it("renders filter chips with data-filter hooks", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    for (const f of ["all", "vulns", "lighthouse", "delivery", "stale", "pending"]) {
      expect(html).toContain(`data-filter="${f}"`);
    }
  });

  it("renders the headline counts (vulns / lighthouse / delivery / pending)", () => {
    const html = renderCockpitHtml(
      model(
        [
          siteRow({
            id: "a",
            name: "Bad",
            securityVulnsCritical: 2,
            securityVulnsHigh: 1,
            pScore: 60,
          }),
        ],
        [],
      ),
    );
    expect(html).toMatch(/3[^<]*vuln/i); // criticalHighVulns = 3
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm test -- fleet-render`
Expected: FAIL — `renderCockpitHtml is not a function` (and the migrated calls error).

- [ ] **Step 3: Implement `renderCockpitHtml` shell + summary bar + chips**

In `src/dashboard/fleet-render.ts`: add imports, extend `STYLES`, and replace `renderFleetHomeHtml` with `renderCockpitHtml`. Add at top:

```ts
import type { CockpitModel, SiteCard, Tier } from "./fleet-cockpit.js";
```

Append to `STYLES` (before the closing backtick):

```ts
.summary { display:flex; flex-wrap:wrap; gap:0.5rem 1.25rem; align-items:baseline; margin-bottom:0.5rem; }
.summary .tier { font-weight:700; }
.summary .heads { color:#666; font-size:0.9rem; }
.filters { display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:1.25rem; }
.filters button { font:inherit; font-size:0.85rem; padding:0.25rem 0.7rem; border:1px solid #ccc; border-radius:999px; background:transparent; color:inherit; cursor:pointer; }
.filters button[aria-pressed="true"] { background:#1a1a1a; color:#fff; border-color:#1a1a1a; }
@media (prefers-color-scheme: dark) { .filters button[aria-pressed="true"] { background:#e8e8e8; color:#111; } }
details.tier { margin:0.75rem 0; }
details.tier > summary { cursor:pointer; font-weight:700; font-size:1.05rem; padding:0.35rem 0; list-style:none; }
.approve-strip { border:1px solid #ffe08a; background:#fff8e1; border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.25rem; }
@media (prefers-color-scheme: dark) { .approve-strip { background:#241f00; border-color:#5a4d00; } }
.approve-strip h2 { font-size:1rem; margin:0 0 0.5rem; }
.approve-row { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; padding:0.25rem 0; }
.pill { font-size:0.75rem; padding:0.1rem 0.5rem; border-radius:999px; font-weight:700; }
.pill.attention { background:#fdecea; color:#b00; }
.pill.watch { background:#fff4e5; color:#a65a00; }
.pill.healthy { background:#e8f5e9; color:#1b7a2f; }
.chips { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.5rem; }
.chip { font-size:0.8rem; padding:0.1rem 0.5rem; border-radius:6px; background:#f0f0f0; }
@media (prefers-color-scheme: dark) { .chip { background:#222; } }
.chip.critical { background:#fdecea; color:#b00; }
.badge { font-weight:700; color:#C00; font-size:0.72rem; margin-right:0.25rem; }
```

Add the summary/filter render helpers and the new entry point (the existing `card` helper is reused as-is in Task 5; for now render cards flat under tiers via a placeholder that Task 5 fills — but to keep this task self-contained, render the tier sections with the existing `card()` and no chips yet, then Task 5 adds chips/badges):

```ts
const TIER_META: Record<Tier, { emoji: string; label: string; open: boolean }> = {
  attention: { emoji: "🔴", label: "Needs attention", open: true },
  watch: { emoji: "🟡", label: "Watch", open: false },
  healthy: { emoji: "🟢", label: "Healthy", open: false },
};

const FILTERS = ["all", "vulns", "lighthouse", "delivery", "stale", "pending"] as const;

function summaryBar(model: CockpitModel): string {
  const s = model.summary;
  const heads = [
    `${s.criticalHighVulns} critical/high vuln${s.criticalHighVulns === 1 ? "" : "s"}`,
    `${s.lighthouseBelowFloor} Lighthouse<75`,
    `${s.deliveryFailures} delivery`,
    `${s.pending} pending`,
  ].join(" · ");
  const chips = FILTERS.map(
    (f) =>
      `<button type="button" data-filter="${f}" aria-pressed="${f === "all" ? "true" : "false"}">${f}</button>`,
  ).join("");
  return `<div class="summary">
      <span class="tier">🔴 ${s.attention} needs attention</span>
      <span class="tier">🟡 ${s.watch} watch</span>
      <span class="tier">🟢 ${s.healthy} healthy</span>
    </div>
    <div class="summary heads">${escapeHtml(heads)}</div>
    <div class="filters">${chips}</div>`;
}
```

Replace `renderFleetHomeHtml(...)` with:

```ts
export function renderCockpitHtml(model: CockpitModel): string {
  const total = model.cards.length;
  const tiers: Tier[] = ["attention", "watch", "healthy"];
  const sections = tiers
    .map((tier) => {
      const cards = model.cards.filter((c) => c.tier === tier);
      const meta = TIER_META[tier];
      const body =
        cards.length === 0
          ? `<div class="empty">None.</div>`
          : `<div class="cards">${cards.map(cockpitCard).join("")}</div>`;
      return `<details class="tier" data-tier="${tier}"${meta.open ? " open" : ""}>
        <summary>${meta.emoji} ${meta.label} (${cards.length})</summary>
        ${body}
      </details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddoor maintenance — fleet cockpit</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet cockpit</h1>
  <div class="meta">${total} site${total === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${summaryBar(model)}
  ${approveStrip(model)}
  ${sections}
  ${FILTER_SCRIPT}
</body>
</html>`;
}
```

For this task, stub the not-yet-built helpers so the file compiles and the summary tests pass — Tasks 4 and 5 replace the stubs:

```ts
function approveStrip(_model: CockpitModel): string {
  return ""; // Task 4
}
function cockpitCard(c: SiteCard): string {
  return card(c.site); // Task 5 adds the status pill, chips, and NEW/WORSE badges
}
const FILTER_SCRIPT = ""; // Task 5
```

Update `src/dashboard/index.ts`: replace `export { renderFleetHomeHtml } from "./fleet-render.js";` with `export { renderCockpitHtml } from "./fleet-render.js";`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-render` then `pnpm typecheck`
Expected: PASS. (The handler `fleet-homepage.mts` still imports `renderFleetHomeHtml` — it will fail typecheck until Task 6; if `pnpm typecheck` errors only there, that's expected and fixed in Task 6. To keep this commit green, complete Task 6's handler edit in the same branch before the final typecheck, or temporarily keep a `renderFleetHomeHtml` re-export. Prefer: do Task 6 before the branch's final typecheck gate.)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-render.ts src/dashboard/index.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): render shell — summary bar, filter chips, tier sections"
```

---

## Task 4: The renderer — pinned approve strip

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("renderCockpitHtml — approve strip", () => {
  it("renders an approve button per pending report, mirroring the per-site endpoint", () => {
    const m = buildCockpitModel(
      [siteRow({ id: "recSITE", name: "Acme Co" })],
      [
        {
          id: "r1",
          siteId: "recSITE",
          reportType: "Maintenance",
          period: "2026-05",
          periodStart: null,
          periodEnd: null,
          gaUsersCurrent: null,
          gaUsersPrevious: null,
          draftReady: true,
          approvedToSend: false,
          sentAt: null,
          deliveryStatus: "pending",
        } as never,
      ],
      {},
      BASE,
      NOW,
    );
    const html = renderCockpitHtml(m);
    expect(html).toContain("Acme Co");
    expect(html).toContain('data-approve-url="/api/reports/r1/approve"');
    expect(html).toContain('class="approve"');
    expect(html).toMatch(/your daily yes|approve \(1\)/i);
  });

  it("renders no approve strip when nothing is pending", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).not.toContain("approve-strip");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- fleet-render`
Expected: FAIL — strip absent (`approve-strip` not found / button missing).

- [ ] **Step 3: Implement `approveStrip`**

Replace the `approveStrip` stub in `src/dashboard/fleet-render.ts`:

```ts
function approveStrip(model: CockpitModel): string {
  if (model.pending.length === 0) return "";
  const rows = model.pending
    .map((p) => {
      const href = `/s/${escapeHtml(p.slug)}`;
      const url = `/api/reports/${encodeURIComponent(p.reportId)}/approve`;
      return `<div class="approve-row" data-signal="pending">
        <strong>${escapeHtml(p.siteName)}</strong>
        <span class="muted">${escapeHtml(p.reportType)} ${escapeHtml(p.period)}</span>
        <button class="approve" data-report-id="${escapeHtml(p.reportId)}" data-approve-url="${url}">Approve</button>
        <a href="${href}">open ▸</a>
      </div>`;
    })
    .join("");
  return `<section class="approve-strip" data-tier="pending">
    <h2>Approve (${model.pending.length}) — your daily yes</h2>
    ${rows}
  </section>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-render`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): pinned approve strip, reusing the M3 approve endpoint"
```

---

## Task 5: The renderer — cockpit cards (status pill, attention chips, NEW/WORSE) + filter JS

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("renderCockpitHtml — cockpit cards", () => {
  it("puts a status pill and the site's attention chips on the card, with data-signals", () => {
    const html = renderCockpitHtml(
      model([
        siteRow({
          id: "a",
          name: "Bad",
          securityVulnsCritical: 2,
          securityVulnsHigh: 1,
          pScore: 60,
        }),
      ]),
    );
    expect(html).toMatch(/class="pill attention"/);
    expect(html).toContain('data-signals="'); // present on the card
    expect(html).toMatch(/2 critical\/high|3 critical\/high/); // vuln chip text from the collector title
    expect(html).toMatch(/Lighthouse Performance 60/); // lighthouse chip
  });

  it("renders a NEW badge for a freshly-flagged item and WORSE for a risen metric", () => {
    const newHtml = renderCockpitHtml(
      model([siteRow({ id: "a", name: "Bad", securityVulnsCritical: 1 })]), // prior {} → NEW
    );
    expect(newHtml).toMatch(/class="badge">NEW/);

    const worse = buildCockpitModel(
      [siteRow({ id: "a", name: "Bad", securityVulnsCritical: 3 })],
      [],
      { "vuln:a": { metric: 1, firstFlaggedAt: "2026-06-01" } },
      BASE,
      NOW,
    );
    expect(renderCockpitHtml(worse)).toMatch(/class="badge">WORSE/);
  });

  it("shows the watch reasons on a watch-tier card", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
    expect(html).toMatch(/Performance 80/);
  });

  it("includes the filter script with the data-filter wiring", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("data-filter");
    expect(html).toMatch(/querySelectorAll|addEventListener/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- fleet-render`
Expected: FAIL — pill/chip/badge/script absent (the stubs return bare `card(site)` / `""`).

- [ ] **Step 3: Implement `cockpitCard` + `FILTER_SCRIPT`**

Replace the `cockpitCard` stub and the `FILTER_SCRIPT` stub in `src/dashboard/fleet-render.ts`:

```ts
const PILL_LABEL: Record<Tier, string> = { attention: "failing", watch: "watch", healthy: "ok" };

function attentionBadge(status?: string): string {
  if (status === "new") return `<span class="badge">NEW</span>`;
  if (status === "worse") return `<span class="badge">WORSE</span>`;
  return "";
}

function chips(c: SiteCard): string {
  const items = c.items.map((it) => {
    const cls = it.severity === "critical" ? "chip critical" : "chip";
    return `<span class="${cls}">${attentionBadge(it.status)}${escapeHtml(it.title)}</span>`;
  });
  for (const reason of c.watchReasons)
    items.push(`<span class="chip">${escapeHtml(reason)}</span>`);
  return items.length ? `<div class="chips">${items.join("")}</div>` : "";
}

/** Space-separated signal kinds for the client filter (+ "stale" for audit-stale watch). */
function signalsAttr(c: SiteCard): string {
  const kinds = new Set(
    c.items.map((it) =>
      it.kind === "vuln"
        ? "vulns"
        : it.kind === "lighthouse"
          ? "lighthouse"
          : it.kind === "delivery"
            ? "delivery"
            : it.kind,
    ),
  );
  if (c.watchReasons.some((r) => /ago/.test(r))) kinds.add("stale");
  return [...kinds].join(" ");
}

function cockpitCard(c: SiteCard): string {
  const base = card(c.site); // existing header + metrics markup
  const pill = `<span class="pill ${c.tier}">${PILL_LABEL[c.tier]}</span>`;
  const extra = `${pill}${chips(c)}`;
  // Inject the pill + chips before the article's closing tag, and add the filter hook.
  return base
    .replace('<article class="card">', `<article class="card" data-signals="${signalsAttr(c)}">`)
    .replace("</article>", `${extra}</article>`);
}

const FILTER_SCRIPT = `<script>
(function(){
  var btns = document.querySelectorAll('.filters button');
  var cards = document.querySelectorAll('.cards .card');
  var details = document.querySelectorAll('details.tier');
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      var f = b.getAttribute('data-filter');
      btns.forEach(function(x){ x.setAttribute('aria-pressed', x===b ? 'true':'false'); });
      if (f !== 'all') details.forEach(function(d){ d.open = true; });
      cards.forEach(function(c){
        var sig = (c.getAttribute('data-signals')||'').split(' ');
        c.style.display = (f==='all' || sig.indexOf(f)!==-1) ? '' : 'none';
      });
      if (f === 'pending') { var s = document.querySelector('.approve-strip'); if (s) s.scrollIntoView({behavior:'smooth'}); }
    });
  });
  // approve buttons: mirror the per-site dashboard's inline POST.
  document.querySelectorAll('button.approve').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Approving…';
      try { var res = await fetch(b.dataset.approveUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Approved ✓' : 'Failed'; }
      catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
})();
</script>`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-render` then `pnpm test -- fleet-cockpit`
Expected: PASS across both files.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): cards with status pill, attention chips, NEW/WORSE badges, filter JS"
```

---

## Task 6: Wire the handler + rate-limiting

**Files:**

- Modify: `netlify/functions/fleet-homepage.mts`

The handler is the thin integration layer (the repo doesn't unit-test `.mts` functions directly; the logic is covered by the pure-core tests). The gate here is `pnpm typecheck` + `pnpm build` green and a manual read-through.

- [ ] **Step 1: Rewrite the handler body to build + render the model**

In `netlify/functions/fleet-homepage.mts`:

1. Update imports:

```ts
import { openBase } from "../../src/reports/airtable/client.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { listAllReports } from "../../src/reports/airtable/reports.js";
import { readDigestState } from "../../src/alerts/digest-state.js";
import { verifyBasicAuth } from "../../src/dashboard/index.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { renderCockpitHtml } from "../../src/dashboard/index.js";
```

2. Add the dashboard base-URL helper and replace the data-fetch + render tail (everything after the auth check) with:

```ts
const base = openBase({ apiKey, baseId });
// Fetch the three inputs once; each defensive so one hiccup can't blank the page.
const websites = await listWebsites(base);
let reports: Awaited<ReturnType<typeof listAllReports>> = [];
try {
  reports = await listAllReports(base);
} catch {
  // approve strip + delivery signals simply absent — triage still renders
}
let prior = {};
try {
  prior = await readDigestState(base);
} catch {
  prior = {}; // everything badges as not-NEW; never crashes the page
}
const baseUrl = (
  process.env.DASHBOARD_BASE_URL?.trim() || "https://reddoor-maintenance.netlify.app"
).replace(/\/$/, "");
const model = buildCockpitModel(websites, reports, prior, baseUrl, new Date());
return html(renderCockpitHtml(model), 200);
```

(Remove the old `visible` filter + `listPendingApproval` count + `renderFleetHomeHtml` call — `buildCockpitModel` now owns the `dashboardToken` filter and the pending list. The `listPendingApproval` import is no longer needed here.)

3. Add Netlify native rate-limiting to the `config` export:

```ts
export const config: Config = {
  path: ["/"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ["ip"],
  },
};
```

(Confirm the `rateLimit` shape against the installed `@netlify/functions` types — `windowSize` in seconds, `windowLimit` requests per window, `aggregateBy: ["ip"]`. If the installed version names them differently, match the type; the intent is a per-IP cap to blunt password brute-force.)

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors; `renderFleetHomeHtml` is fully removed and nothing imports it.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all green (no remaining `renderFleetHomeHtml` references in tests).

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: clean (run `pnpm format` first if prettier flags formatting).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/fleet-homepage.mts
git commit -m "feat(cockpit): wire the fleet homepage to the cockpit model + rate-limit it"
```

---

## Task 7: Changeset + final review

- [ ] **Step 1: Add a changeset**

Create `.changeset/m4-cockpit-slice1.md`:

```md
---
"@reddoorla/maintenance": minor
---

feat(cockpit): the fleet homepage is now a triage cockpit (M4 slice 1). Sites group into 🔴 Needs-attention / 🟡 Watch / 🟢 Healthy tiers (collapsible), with the approve queue pinned on top. Each card shows its live M5 signals — critical/high vulns, sub-75 Lighthouse categories, delivery bounces/complaints — badged NEW/WORSE to match the daily email digest (the Digest State snapshot is read read-only, never written from the page). A summary bar gives the tier counts + headline triage line and filter chips. Rendered entirely from already-persisted Airtable state (no request-path GitHub/Lighthouse calls) and rate-limited against brute-force. Renovate-failing / CI-red / staleness signals follow in slice 2.
```

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset/m4-cockpit-slice1.md
git commit -m "chore(changeset): M4 cockpit slice 1"
```

- [ ] **Step 3: Final full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green.

Then the AUTONOMY.md 3-lens adversarial review (spec-compliance lens, code-quality lens, and a LIVE lens reading the cockpit model against the real Airtable base read-only) before the head-SHA-gated autonomous merge.

---

## Slice 2 (sketch — separate plan, not built here)

The nightly audit/digest cron persists per-site **Renovate-failing-PR count**, **CI status**, and **last-deploy timestamp** into new Websites fields. Then: `buildCockpitModel` reads them — a Renovate-failing or CI-red site joins 🔴 attention; deploy-staleness > 30d joins 🟡 watch — and `cockpitCard` lights up the `⬆ PRs failing` and staleness chips. The `[ PRs ]` filter chip is added. No request-path GitHub calls (the cron does the GitHub work; the page reads Airtable). Each addition TDD + 3-lens, its own PR.

## Self-review notes

- **Spec coverage:** tiers (§3) → Task 1/2; summary bar + chips (§3) → Task 3/5; approve strip (§3) → Task 4; read-only Digest State diff (§2) → Task 2 (`diffAttention` `next` discarded, asserted); read-from-Airtable render path (§4) → Task 6; rate-limiting (§7) → Task 6; auth consolidation (§5.4) → deliberately deferred (single consumer; not worth the churn yet — noted, not silently dropped).
- **Type consistency:** `CockpitModel`/`SiteCard`/`PendingEntry`/`Tier` defined once in Task 2 and consumed unchanged by the renderer (Task 3–5) and handler (Task 6). `renderCockpitHtml(model)` is the single public render signature throughout.
- **No placeholders:** every step ships real code/tests; the only intentional stubs (Task 3) are explicitly replaced in Tasks 4–5 and called out as such.
