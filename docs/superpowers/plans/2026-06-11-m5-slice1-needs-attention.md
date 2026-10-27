# M5 Slice 1 — Digest "Needs attention" (delivery + vulns + the hybrid framework) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the M3 digest's hard-coded-empty "Needs attention" section with the two zero-infra signals (delivery bounces/complaints + current critical/high vulns), rendered as a daily snapshot grouped by site that badges what's NEW or WORSE since the last digest.

**Architecture:** Pure collectors produce keyed `AttentionItem`s from already-fetched Airtable data; a pure `diffAttention` tags each NEW/WORSE/STANDING against a prior snapshot stored in a single Airtable "Digest State" record; `runDigest` wires collect→read→diff→render→write-back; `attentionSection` groups by site and badges. Slices 2 (Renovate) and 3 (Lighthouse) extend the same framework later.

**Tech Stack:** TypeScript, vitest (DI fakes), Airtable, Resend.

**Design spec:** [docs/superpowers/specs/2026-06-11-m5-alerting-design.md](specs/2026-06-11-m5-alerting-design.md)

---

## Build order

1. **Component 1 — pure core** (type + collectors + diffAttention) — no IO, no wiring.
2. **Component 2 — state store** (Digest State singleton IO) — depends on C1's digest-state.ts file.
3. **Component 3 — wire + render** (collectAttention + runDigest integration + grouped/badged attentionSection) — depends on C1 + C2.

May land as one PR (slice 1) or split if large — the implementer decides at gate time. Slices 2 & 3 are separate later plans.

---

## Component 1: Pure core — extended AttentionItem + collectVulnAlerts + collectDeliveryFailures + diffAttention

I have full context now. The existing `collectRenovateFailures` in `src/alerts/renovate.ts` already uses the name from the naming contract — but with a different signature (it's async, takes `Site[]` + probe). The contract's component-1 collectors are different functions (`collectVulnAlerts`, `collectDeliveryFailures`). The renovate collector is slice 2, out of scope. No naming collision concern for component 1's new files.

Now I'll produce the component-1 plan tasks.

### Task 1.1: Extended `AttentionItem` type + keep render/run green

**Files:**

- Modify: `src/reports/digest.ts` (replace the `AttentionItem` type at lines 27–32; touch `attentionSection` at lines 82–100 only if needed; `runDigest` `needsAttention` declaration at line 164 stays `[]`)
- Modify: `tests/reports/digest.test.ts` (the two existing `needsAttention` fixtures at lines 53–63 and 71–81 reference the OLD `{kind,title,url}` shape — make them satisfy the new required fields)

- [ ] **Step 1: Write the failing test**

The render tests already exist; the new contract makes `AttentionItem` require `key`/`siteName`/`severity`/`metric`, so the two inline `{ kind, title, url }` literals at lines 57 and 75 of `tests/reports/digest.test.ts` will no longer typecheck. Update them to the new shape, and add one assertion that the renderer tolerates the new fields (renders by `title`/`url`, ignores the rest for now — full grouping is component 3). Edit the existing fixtures and append one test:

```ts
// tests/reports/digest.test.ts — UPDATE the two needsAttention literals to the new shape:

// (was) needsAttention: [{ kind: "tracking-issue", title: "daily-reports-failing", url: "https://github.com/x/1" }]
needsAttention: [
  {
    key: "vuln:rec1",
    kind: "vuln",
    siteName: "Acme Co",
    title: "daily-reports-failing",
    url: "https://github.com/x/1",
    severity: "critical",
    metric: 3,
  },
],

// (was) needsAttention: [{ kind: "tracking-issue", title: "bad-link", url: "javascript:alert(1)" }]
needsAttention: [
  {
    key: "delivery:rec2",
    kind: "delivery",
    siteName: "Acme Co",
    title: "bad-link",
    url: "javascript:alert(1)",
    severity: "warning",
    metric: 1,
  },
],

// APPEND a new test (component-1 contract: renderer tolerates the new fields, still renders title/url):
it("renders an AttentionItem with the M5-extended shape by title + https url", () => {
  const html = renderDigestHtml(
    sections({
      readyForYourYes: [],
      needsAttention: [
        {
          key: "vuln:recX",
          kind: "vuln",
          siteName: "Acme Co",
          title: "3 critical/high vulns",
          url: "https://reddoor-maintenance.netlify.app/s/acme-co",
          severity: "critical",
          metric: 3,
        },
      ],
    }),
  );
  expect(html).toContain("3 critical/high vulns");
  expect(html).toContain('href="https://reddoor-maintenance.netlify.app/s/acme-co"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/reports/digest.test.ts -t "M5-extended shape"`
Expected: FAIL — TypeScript compile error: `Object literal may only specify known properties` / `Property 'key' is missing in type` (the test file references the new shape; the OLD `AttentionItem` in `src/reports/digest.ts` lacks `key`/`siteName`/`severity`/`metric`). (Until step 3 lands the type, the file does not typecheck.)

- [ ] **Step 3: Write minimal implementation**

Replace the `AttentionItem` type block (lines 27–32 of `src/reports/digest.ts`) with the contract shape. `attentionSection` already reads only `it.title` + `it.url` (lines 88–91) — that keeps working unchanged and tolerates the new fields, exactly as the component scope requires (grouping is component 3).

```ts
// src/reports/digest.ts — replaces the OLD AttentionItem (lines 27–32)

/** Severity of a "Needs attention" entry. `critical` sorts above `warning`. */
export type AttentionSeverity = "critical" | "warning";

/** Set by `diffAttention` before render: how this item changed since the prior digest. */
export type AttentionStatus = "new" | "worse" | "standing";

/**
 * One "Needs attention" entry. The M5 SEAM, now carrying the fields the hybrid
 * snapshot needs: a stable `key` for diffing, a `metric` for NEW/WORSE comparison,
 * a `severity` for ordering, and `siteName` for the (component-3) grouped render.
 * For now `attentionSection` still renders each item flat by `title`/`url`.
 */
export type AttentionItem = {
  /** Stable identity for diffing: `vuln:<siteId>`, `delivery:<reportId>`. */
  key: string;
  kind: "vuln" | "delivery" | "renovate" | "lighthouse";
  /** Grouping key in the (component-3) render. */
  siteName: string;
  title: string;
  /** Optional URL rendered as a hyperlink on the title. */
  url?: string;
  severity: AttentionSeverity;
  /** Comparable magnitude for NEW/WORSE (vuln count; 1 for binary events). */
  metric: number;
  /** Set by `diffAttention` before render. */
  status?: AttentionStatus;
};
```

`runDigest`'s `const needsAttention: AttentionItem[] = []` (line 164) stays empty for this component — wiring is component 3. No change to `attentionSection` is required (it already only touches `title`/`url`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/reports/digest.test.ts`
Expected: PASS (all existing render/email-safety tests plus the new M5-extended-shape test).

- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest.test.ts && git commit -m "feat(alerts): grow the AttentionItem seam to the M5 hybrid shape (key/metric/severity/siteName)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: `collectVulnAlerts` (pure) — critical+high threshold, severity, url, skip-zero

**Files:**

- Create: `src/alerts/digest-collectors.ts`
- Create (Test): `tests/alerts/digest-collectors.test.ts`

- [ ] **Step 1: Write the failing test**

Grounded in the real `WebsiteRow` (`securityVulnsCritical`/`securityVulnsHigh` are `number | null`; `siteSlug`/`name` real) and the real dashboard-link shape `${baseUrl}/s/${siteSlug(name)}`:

```ts
// tests/alerts/digest-collectors.test.ts
import { describe, it, expect } from "vitest";
import { collectVulnAlerts } from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

const BASE = "https://reddoor-maintenance.netlify.app";

/** Minimal WebsiteRow — only the fields the collector reads matter; the rest are nulled. */
function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec_site_acme",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: null,
    ...over,
  };
}

describe("collectVulnAlerts", () => {
  it("flags a site with critical vulns: key, metric=critical+high, severity critical, dashboard url", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 2, securityVulnsHigh: 1 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "vuln:rec_site_acme",
      kind: "vuln",
      siteName: "Acme Co",
      severity: "critical",
      metric: 3,
      url: `${BASE}/s/acme-co`,
    });
  });

  it("severity is 'warning' when there are high but zero critical", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 4 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe("warning");
    expect(items[0]!.metric).toBe(4);
  });

  it("treats null counts as zero (never audited) and skips the site", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: null, securityVulnsHigh: null })],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("skips a clean site (critical+high == 0)", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 0 })],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("ignores moderate/low — only critical+high count toward the threshold and metric", () => {
    const items = collectVulnAlerts(
      [
        site({
          securityVulnsCritical: 0,
          securityVulnsHigh: 0,
          securityVulnsModerate: 9,
          securityVulnsLow: 9,
        }),
      ],
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("strips a trailing slash from baseUrl (no //s/ in the link)", () => {
    const items = collectVulnAlerts([site({ securityVulnsHigh: 1 })], `${BASE}/`);
    expect(items[0]!.url).toBe(`${BASE}/s/acme-co`);
    expect(items[0]!.url).not.toContain("//s/");
  });

  it("title states the critical/high count for the operator's glance", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 1, securityVulnsHigh: 2 })],
      BASE,
    );
    expect(items[0]!.title).toMatch(/3/);
    expect(items[0]!.title).toMatch(/critical\/high/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/alerts/digest-collectors.test.ts -t "flags a site with critical vulns"`
Expected: FAIL — `Cannot find module '../../src/alerts/digest-collectors.js'` (the file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/alerts/digest-collectors.ts
import type { AttentionItem } from "../reports/digest.js";
import { siteSlug, type WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";

/** Build the same `/s/<slug>` dashboard link the M3 ready-section uses, trailing-slash-safe. */
function dashboardUrl(baseUrl: string, siteName: string): string {
  return `${baseUrl.replace(/\/$/, "")}/s/${siteSlug(siteName)}`;
}

/**
 * One attention item per site carrying current critical+high vulns (medium/low omitted
 * per the locked threshold). PURE: takes already-fetched Websites rows. `metric` is the
 * critical+high count (so a rising count diffs as WORSE); `severity` is `critical` when
 * any critical exists, else `warning`. Null counts (never audited) read as 0 → skipped.
 */
export function collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    const metric = critical + high;
    if (metric <= 0) continue;
    items.push({
      key: `vuln:${s.id}`,
      kind: "vuln",
      siteName: s.name,
      title: `${metric} critical/high ${metric === 1 ? "vuln" : "vulns"}`,
      url: dashboardUrl(baseUrl, s.name),
      severity: critical > 0 ? "critical" : "warning",
      metric,
    });
  }
  return items;
}
```

(`ReportRow` is imported now so the next task's `collectDeliveryFailures` can be appended to the same file without a second import edit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/alerts/digest-collectors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/alerts/digest-collectors.ts tests/alerts/digest-collectors.test.ts && git commit -m "feat(alerts): pure collectVulnAlerts — critical+high threshold, severity, dashboard link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: `collectDeliveryFailures` (pure) — bounced/complained only, complaint=critical, orphan skip

**Files:**

- Modify: `src/alerts/digest-collectors.ts` (append `collectDeliveryFailures`)
- Modify (Test): `tests/alerts/digest-collectors.test.ts` (append a `describe` block)

- [ ] **Step 1: Write the failing test**

Grounded in the real `ReportRow` (`deliveryStatus: DeliveryStatus` ∈ pending|delivered|bounced|complained; `siteId: string`; `reportId`/`id` real) and `sitesById: Map<string, WebsiteRow>` keyed by the Airtable record id (`r.siteId` is `linkSites[0]`, i.e. `rec...`, matching `WebsiteRow.id`):

```ts
// tests/alerts/digest-collectors.test.ts — APPEND

import { collectDeliveryFailures } from "../../src/alerts/digest-collectors.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "rec_report_1",
    reportId: "Acme Co — Maintenance — 2026-06",
    siteId: "rec_site_acme",
    reportType: "Maintenance",
    period: "2026-06",
    periodStart: null,
    periodEnd: null,
    completedOn: null,
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-06-01T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "bounced",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    ...over,
  };
}

describe("collectDeliveryFailures", () => {
  const byId = new Map<string, WebsiteRow>([["rec_site_acme", site()]]);

  it("flags a bounced report: key delivery:<reportId-recordId>, metric 1, severity warning, site url", () => {
    const items = collectDeliveryFailures([report({ deliveryStatus: "bounced" })], byId, BASE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "delivery:rec_report_1",
      kind: "delivery",
      siteName: "Acme Co",
      severity: "warning",
      metric: 1,
      url: `${BASE}/s/acme-co`,
    });
  });

  it("ranks a complaint above a bounce: severity critical", () => {
    const items = collectDeliveryFailures([report({ deliveryStatus: "complained" })], byId, BASE);
    expect(items[0]!.severity).toBe("critical");
  });

  it("ignores delivered and pending reports (only bounced/complained qualify)", () => {
    const items = collectDeliveryFailures(
      [
        report({ id: "rec_a", deliveryStatus: "delivered" }),
        report({ id: "rec_b", deliveryStatus: "pending" }),
      ],
      byId,
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("skips an orphan report whose site is not in the map (no broken link)", () => {
    const items = collectDeliveryFailures(
      [report({ siteId: "rec_missing", deliveryStatus: "bounced" })],
      byId,
      BASE,
    );
    expect(items).toEqual([]);
  });

  it("keys on the report record id so two failures on the same site stay distinct", () => {
    const items = collectDeliveryFailures(
      [
        report({ id: "rec_x", deliveryStatus: "bounced" }),
        report({ id: "rec_y", deliveryStatus: "complained" }),
      ],
      byId,
      BASE,
    );
    expect(items.map((i) => i.key)).toEqual(["delivery:rec_x", "delivery:rec_y"]);
  });

  it("title names the failure mode for the operator", () => {
    const bounced = collectDeliveryFailures([report({ deliveryStatus: "bounced" })], byId, BASE);
    const complained = collectDeliveryFailures(
      [report({ id: "rec_c", deliveryStatus: "complained" })],
      byId,
      BASE,
    );
    expect(bounced[0]!.title).toMatch(/bounce/i);
    expect(complained[0]!.title).toMatch(/complaint|complained/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/alerts/digest-collectors.test.ts -t "flags a bounced report"`
Expected: FAIL — `collectDeliveryFailures is not a function` / no matching export from `src/alerts/digest-collectors.js`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/alerts/digest-collectors.ts` (the `ReportRow`/`AttentionItem`/`siteSlug`/`WebsiteRow`/`dashboardUrl` imports/helper already exist from C2):

```ts
// src/alerts/digest-collectors.ts — APPEND

import type { WebsiteRow as _Unused } from "../reports/airtable/websites.js"; // (already imported in C2 — do NOT re-add)

/**
 * One attention item per report whose `deliveryStatus` is a failure (`bounced` or
 * `complained` — `delivered`/`pending` are ignored). PURE: takes already-fetched
 * Reports rows + a record-id→site map. A complaint ranks above a bounce (locked
 * threshold), so `severity` is `critical` for complained / `warning` for bounced.
 * `metric` is 1 (a binary event). Orphans (siteId not in the map) are skipped, as
 * the M3 ready-section does, so the digest never renders a broken link. The diff
 * key is the report RECORD id, so two failures on one site stay distinct.
 */
export function collectDeliveryFailures(
  reports: ReportRow[],
  sitesById: Map<string, WebsiteRow>,
  baseUrl: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of reports) {
    if (r.deliveryStatus !== "bounced" && r.deliveryStatus !== "complained") continue;
    const site = sitesById.get(r.siteId);
    if (!site) continue; // orphan → skip rather than render a broken link
    const complained = r.deliveryStatus === "complained";
    items.push({
      key: `delivery:${r.id}`,
      kind: "delivery",
      siteName: site.name,
      title: complained ? "Spam complaint on a sent report" : "A sent report bounced",
      url: dashboardUrl(baseUrl, site.name),
      severity: complained ? "critical" : "warning",
      metric: 1,
    });
  }
  return items;
}
```

Note: the `WebsiteRow` type is already imported in the C2 header (`import { siteSlug, type WebsiteRow }`); do NOT add the placeholder `_Unused` line above — it is shown only to flag that no new import is needed. Implementer adds only the function body.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/alerts/digest-collectors.test.ts`
Expected: PASS (both `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/alerts/digest-collectors.ts tests/alerts/digest-collectors.test.ts && git commit -m "feat(alerts): pure collectDeliveryFailures — bounce/complaint only, complaint=critical, orphan-safe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: `diffAttention` (pure) — NEW/WORSE/STANDING + next snapshot

**Files:**

- Create: `src/alerts/digest-state.ts` (only the `DigestSnapshot` type + pure `diffAttention` in this component; the IO `readDigestState`/`writeDigestState` are component 2)
- Create (Test): `tests/alerts/digest-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/alerts/digest-state.test.ts
import { describe, it, expect } from "vitest";
import { diffAttention, type DigestSnapshot } from "../../src/alerts/digest-state.js";
import type { AttentionItem } from "../../src/reports/digest.js";

const TODAY = "2026-06-11";

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:rec1",
    kind: "vuln",
    siteName: "Acme Co",
    title: "2 critical/high vulns",
    url: "https://reddoor-maintenance.netlify.app/s/acme-co",
    severity: "critical",
    metric: 2,
    ...over,
  };
}

describe("diffAttention", () => {
  it("tags an item absent from prior as NEW and stamps firstFlaggedAt=today", () => {
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], {}, TODAY);
    expect(tagged[0]!.status).toBe("new");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: TODAY });
  });

  it("tags an item whose metric rose above prior as WORSE and KEEPS the original firstFlaggedAt", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 5 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("worse");
    expect(next["vuln:rec1"]).toEqual({ metric: 5, firstFlaggedAt: "2026-06-01" });
  });

  it("tags an unchanged item as STANDING and preserves firstFlaggedAt", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("standing");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });

  it("a dropping metric is STANDING (only a RISE is WORSE), firstFlaggedAt preserved", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 5, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("standing");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });

  it("next holds EXACTLY the current items' keys — a resolved prior key drops out", () => {
    const prior: DigestSnapshot = {
      "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" },
      "vuln:gone": { metric: 9, firstFlaggedAt: "2026-05-01" },
    };
    const { next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(Object.keys(next)).toEqual(["vuln:rec1"]);
    expect(next["vuln:gone"]).toBeUndefined();
  });

  it("a fixed-then-recurring problem re-news (dropped key → absent → NEW, firstFlaggedAt=today)", () => {
    // day 1: present
    const r1 = diffAttention([item({ key: "vuln:rec1", metric: 2 })], {}, "2026-06-01");
    expect(r1.tagged[0]!.status).toBe("new");
    // day 2: resolved (no items) → snapshot empties
    const r2 = diffAttention([], r1.next, "2026-06-02");
    expect(r2.next).toEqual({});
    // day 3: recurs → NEW again, firstFlaggedAt is the recurrence day, not the original
    const r3 = diffAttention([item({ key: "vuln:rec1", metric: 2 })], r2.next, "2026-06-03");
    expect(r3.tagged[0]!.status).toBe("new");
    expect(r3.next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-03" });
  });

  it("does not mutate the input items (returns tagged copies)", () => {
    const input = item({ key: "vuln:rec1", metric: 2 });
    diffAttention([input], {}, TODAY);
    expect(input.status).toBeUndefined();
  });

  it("does not mutate the prior snapshot", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    diffAttention([item({ key: "vuln:rec1", metric: 5 })], prior, TODAY);
    expect(prior["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/alerts/digest-state.test.ts -t "tags an item absent from prior as NEW"`
Expected: FAIL — `Cannot find module '../../src/alerts/digest-state.js'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/alerts/digest-state.ts
import type { AttentionItem } from "../reports/digest.js";

/**
 * The persisted prior-run snapshot: stable item `key` → its last metric + the
 * date it was FIRST flagged. Lives as JSON in the single "Digest State" Airtable
 * row (the IO that loads/stores it — readDigestState/writeDigestState — is added
 * in component 2). `next` from diffAttention is what gets written back.
 */
export type DigestSnapshot = Record<string, { metric: number; firstFlaggedAt: string }>;

/**
 * PURE diff — the testable core of the hybrid "snapshot now, mark what's new".
 * For each current item vs the prior snapshot:
 *   - key absent from prior            → NEW      (firstFlaggedAt = today)
 *   - present and metric > prior.metric → WORSE    (keep the original firstFlaggedAt)
 *   - otherwise (equal or dropped)      → STANDING (keep the original firstFlaggedAt)
 * `next` contains EXACTLY the current items' keys: resolved keys drop out, so a
 * fixed-then-recurring problem re-news correctly. Neither input is mutated.
 */
export function diffAttention(
  items: AttentionItem[],
  prior: DigestSnapshot,
  today: string,
): { tagged: AttentionItem[]; next: DigestSnapshot } {
  const tagged: AttentionItem[] = [];
  const next: DigestSnapshot = {};
  for (const it of items) {
    const was = prior[it.key];
    let status: AttentionItem["status"];
    let firstFlaggedAt: string;
    if (!was) {
      status = "new";
      firstFlaggedAt = today;
    } else if (it.metric > was.metric) {
      status = "worse";
      firstFlaggedAt = was.firstFlaggedAt;
    } else {
      status = "standing";
      firstFlaggedAt = was.firstFlaggedAt;
    }
    tagged.push({ ...it, status });
    next[it.key] = { metric: it.metric, firstFlaggedAt };
  }
  return { tagged, next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/alerts/digest-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/alerts/digest-state.ts tests/alerts/digest-state.test.ts && git commit -m "feat(alerts): pure diffAttention — NEW/WORSE/STANDING + next snapshot (re-news on recur)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**Component 1 reviewer notes:**

Current-code surprises and risks worth flagging to later components:

- **The `AttentionItem` change is genuinely breaking, but the blast radius is tiny.** Only two consumers reference the OLD `{kind,title,url}` shape: `attentionSection` (reads only `it.title` + `it.url` at `src/reports/digest.ts:88–91` — already forward-compatible, no change needed) and the two inline test fixtures in `tests/reports/digest.test.ts:57,75` (updated in C1). `runDigest`'s `needsAttention` stays `[]` this component; the collectors/diff are not yet wired (that's component 3). I deliberately changed `kind` from the old `string` to the contract's `"vuln"|"delivery"|"renovate"|"lighthouse"` union — the old test literals used `kind: "tracking-issue"`, which is why those fixtures MUST be edited, not just augmented.
- **Name-collision caution for component 3 / slice 2:** `src/alerts/renovate.ts` ALREADY exports a function named `collectRenovateFailures` — but with a totally different signature (`(sites: Site[], probe) => Promise<RenovateFailuresResult>`, returning its own `RenovateFailureFinding` shape, NOT `AttentionItem[]`). It is slice-2 / out of scope here. When slice 2 adapts it into the digest it'll need a thin `AttentionItem` adapter, not a rename. No collision in component 1 (new file `digest-collectors.ts`).
- **`r.siteId` semantics — load-bearing for the delivery key + map lookup:** in `reports.ts:46`, `siteId = linkSites[0] ?? ""`, i.e. the Airtable RECORD id (`rec...`) of the linked site, which is exactly `WebsiteRow.id`. So `sitesById` must be keyed by `WebsiteRow.id` (component 3 builds it as `new Map(websites.map(w => [w.id, w]))` — the same map `runDigest` already builds at `digest.ts:147`). An orphan report has `siteId === ""` (no link) or a stale id → `.get()` miss → skipped, matching the ready-section's orphan behavior.
- **Delivery diff is binary (`metric: 1`), so a delivery item is only ever NEW or STANDING, never WORSE** — that's correct and intended (a bounce doesn't "get worse"; the key is the report record id, so a re-bounce of a _different_ report is a different key). The WORSE path is exercised by vulns. Component 3 should be aware the delivery key never changes metric.
- **`securityVulnsCritical`/`High` are `number | null`** (null = never audited). The collector's `?? 0` makes null read as zero → skipped. This means a site that has never run the security audit is silent, which is the right default (no false alarm), but worth a one-line mention in the component-3 PR description.
- **Names component 2 depends on (must match exactly):** `DigestSnapshot` and the `{ metric, firstFlaggedAt }` value shape are defined in `src/alerts/digest-state.ts` here; component 2 adds `readDigestState`/`writeDigestState` to that SAME file (single "Digest State" row, `Snapshot` long-text JSON + `Updated At` dateTime). Component 3 imports `collectVulnAlerts` + `collectDeliveryFailures` from `src/alerts/digest-collectors.ts` and `diffAttention` + `DigestSnapshot` from `src/alerts/digest-state.ts`, and threads `baseUrl` (trailing-slash already stripped inside the collectors via `dashboardUrl`, matching `runDigest`'s own `.replace(/\/$/,"")` at `digest.ts:159`).
- **Test-fake caveat (carried from the M3 tests):** `makeFakeBase` does NOT evaluate `filterByFormula` and these collectors are pure (no base at all), so every collector test seeds exact in-memory rows — no formula correctness is in play until component 2's singleton get-or-create, which DOES rely on the fake's create/update capture (`__calls`/`__records`).

---

## Component 2: State store — Digest State Airtable singleton + readDigestState/writeDigestState

`digest-state.ts` does not exist yet — C1 (per the plan ordering) creates it first with `diffAttention`, then this component (C2) appends `readDigestState`/`writeDigestState`. The fake base does not seed a "Digest State" table by default, but `makeFakeBase` lazily `ensure()`s any table on first access, so no fake extension is strictly needed. Let me verify the fake's `select` returns the seeded rows for an arbitrary table name and confirm there's no special-casing.

I have everything I need. The fake's `tableFn` works for any table string (lazy `ensure()`), `select().eachPage(cb)` hands back whatever's in `__records.get(table)`, `create` appends with a generated id, and `update` mutates by id and is captured in `__calls`. The fake does NOT evaluate `filterByFormula`, so `readDigestState` must read the first row of an unfiltered/single-row select. No fake extension required — only a "Digest State" seed key in tests that need a pre-existing row.

Here is the drafted plan for Component 2.

### Task 2.1: State store — `readDigestState` / `writeDigestState` over the "Digest State" singleton

**Files:**

- Modify: `src/alerts/digest-state.ts` (APPEND below the C1 `diffAttention` block — add `DIGEST_STATE_TABLE`, `readDigestState`, `writeDigestState`; add the `AirtableBase` import)
- Test: `tests/alerts/digest-state.test.ts` (APPEND a new `describe("readDigestState / writeDigestState")` block; the file already exists from C1)

> Pre-flight assumptions (verified against the real code, 2026-06-11):
>
> - C1 already created `src/alerts/digest-state.ts` exporting `type DigestSnapshot = Record<string, { metric: number; firstFlaggedAt: string }>` and `diffAttention(...)`, plus `tests/alerts/digest-state.test.ts`. This task APPENDS; it does not recreate either.
> - The fake base (`tests/reports/_helpers/fake-airtable-base.ts`) lazily `ensure()`s any table name on first access (`select`/`create`/`update`), so **no fake extension is needed** — a test that wants a pre-existing row just passes `makeFakeBase({ "Digest State": [ ... ] })`; one that wants the empty case passes `makeFakeBase()` (or `{ "Digest State": [] }`). The fake does NOT evaluate `filterByFormula`, so `readDigestState` reads `records[0]` of an unfiltered single-row select — never relies on a formula.

---

- [ ] **Step 1: Write the failing test**

Append to `tests/alerts/digest-state.test.ts`. Match the repo's DI-fake style (`makeFakeBase` + `base.__calls` capture), importing the new symbols alongside C1's:

```ts
// ── append to the existing imports at the top of tests/alerts/digest-state.test.ts ──
// (C1 already imports diffAttention + DigestSnapshot from the module under test)
import {
  readDigestState,
  writeDigestState,
  DIGEST_STATE_TABLE,
} from "../../src/alerts/digest-state.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// ── append this describe block to tests/alerts/digest-state.test.ts ──
describe("readDigestState / writeDigestState", () => {
  it("exposes the exact Airtable table name", () => {
    expect(DIGEST_STATE_TABLE).toBe("Digest State");
  });

  it("reads + JSON-parses the Snapshot field of the single row", async () => {
    const snap = { "vuln:rec_a": { metric: 3, firstFlaggedAt: "2026-06-10" } };
    const base = makeFakeBase({
      "Digest State": [{ id: "rec_state", fields: { Snapshot: JSON.stringify(snap) } }],
    });
    const out = await readDigestState(base);
    expect(out).toEqual(snap);
  });

  it("returns {} when the Digest State table is empty (read miss → safe degrade)", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("returns {} when the table has no seed at all", async () => {
    // makeFakeBase lazily ensures the table; an unseeded read must not throw.
    const base = makeFakeBase();
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("returns {} when the Snapshot field holds malformed JSON (parse miss → safe degrade)", async () => {
    const base = makeFakeBase({
      "Digest State": [{ id: "rec_state", fields: { Snapshot: "{not valid json" } }],
    });
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("write CREATES a row when none exists, stamping Snapshot + the injected Updated At", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const snap = { "delivery:rec_r": { metric: 1, firstFlaggedAt: "2026-06-11" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");

    const create = base.__calls.find((c) => c.kind === "create");
    expect(create).toBeDefined();
    expect(base.__calls.some((c) => c.kind === "update")).toBe(false);
    expect(create!.table).toBe("Digest State");
    const fields = create!.records[0]!.fields;
    expect(JSON.parse(fields["Snapshot"] as string)).toEqual(snap);
    expect(fields["Updated At"]).toBe("2026-06-11T00:00:00.000Z");
  });

  it("write UPDATES the existing row (not create), keying off its record id", async () => {
    const base = makeFakeBase({
      "Digest State": [
        { id: "rec_state", fields: { Snapshot: "{}", "Updated At": "2026-06-10T00:00:00.000Z" } },
      ],
    });
    const snap = { "vuln:rec_a": { metric: 5, firstFlaggedAt: "2026-06-09" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");

    expect(base.__calls.some((c) => c.kind === "create")).toBe(false);
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update).toBeDefined();
    expect(update!.table).toBe("Digest State");
    expect(update!.records[0]!.id).toBe("rec_state");
    const fields = update!.records[0]!.fields;
    expect(JSON.parse(fields["Snapshot"] as string)).toEqual(snap);
    expect(fields["Updated At"]).toBe("2026-06-11T00:00:00.000Z");
  });

  it("write defaults Updated At to now (ISO) when no timestamp is injected", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    await writeDigestState(base, {});
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Updated At"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("round-trips: a written snapshot reads back equal", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const snap = { "vuln:rec_a": { metric: 2, firstFlaggedAt: "2026-06-11" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");
    const out = await readDigestState(base);
    expect(out).toEqual(snap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/alerts/digest-state.test.ts -t "readDigestState / writeDigestState"`
Expected: FAIL — `readDigestState`, `writeDigestState`, and `DIGEST_STATE_TABLE` are not exported from `src/alerts/digest-state.ts` (TS/import resolution error: "has no exported member 'readDigestState'").

- [ ] **Step 3: Write minimal implementation**

APPEND to `src/alerts/digest-state.ts` (below C1's `diffAttention`). Add the `AirtableBase` import at the top of the file if C1 didn't already import it (C1's diff is pure, so it likely has no Airtable import yet — add it). The select idiom mirrors `listAllReports` in `src/reports/airtable/reports.ts`; the create/update idiom mirrors `createDraft`/`stampSent`.

```ts
// ── add to the import block at the TOP of src/alerts/digest-state.ts ──
import type { FieldSet, Records } from "airtable";
import type { AirtableBase } from "../reports/airtable/client.js";

// ── APPEND below diffAttention in src/alerts/digest-state.ts ──

/** The single-row Airtable table that persists the prior digest snapshot. */
export const DIGEST_STATE_TABLE = "Digest State";

/**
 * Read the persisted prior snapshot from the "Digest State" singleton.
 *
 * Reads the FIRST row of an unfiltered select (the table holds exactly one row;
 * the test fake does not evaluate filterByFormula, so we never rely on one). A
 * read miss (no row) OR a parse error (malformed Snapshot JSON) collapses to `{}`
 * — every key then reads as NEW once, which is safe degradation (never crashes
 * the digest).
 */
export async function readDigestState(base: AirtableBase): Promise<DigestSnapshot> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  await base(DIGEST_STATE_TABLE)
    .select({ maxRecords: 1, pageSize: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  const first = rows[0];
  if (!first) return {};
  const raw = first.fields["Snapshot"];
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as DigestSnapshot;
  } catch {
    return {};
  }
}

/**
 * Persist the next snapshot to the "Digest State" singleton: get-or-create the
 * one row. If a row exists, UPDATE it (keyed by its record id); otherwise CREATE
 * one. `Snapshot` = JSON.stringify(snap); `Updated At` = the injected ISO
 * timestamp (or now). A caller that catches+logs a write failure keeps the
 * already-sent digest unaffected (next run re-news at worst).
 */
export async function writeDigestState(
  base: AirtableBase,
  snap: DigestSnapshot,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  const rows: { id: string }[] = [];
  await base(DIGEST_STATE_TABLE)
    .select({ maxRecords: 1, pageSize: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id });
      fetchNextPage();
    });
  const fields: FieldSet = {
    Snapshot: JSON.stringify(snap),
    "Updated At": updatedAt,
  };
  const existing = rows[0];
  if (existing) {
    await base(DIGEST_STATE_TABLE).update([{ id: existing.id, fields }]);
  } else {
    await base(DIGEST_STATE_TABLE).create([{ fields }]);
  }
}
```

> Note on the unused `Records` import: only add `Records` if `tsc`/eslint needs it for a cast — the calls above don't cast the create/update results, so import ONLY `FieldSet` from `"airtable"` (drop `Records`) to avoid the `no-unused-vars` lint that `pnpm lint` checks. Keep `FieldSet` (it types the shared `fields` object passed to both update and create, matching `createDraft`'s `const fields: FieldSet = {...}`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/alerts/digest-state.test.ts`
Expected: PASS (the full file — C1's `diffAttention` tests plus the appended state-store block).

- [ ] **Step 5: Commit**

```bash
git add src/alerts/digest-state.ts tests/alerts/digest-state.test.ts && git commit -m "feat(alerts): persist the prior digest snapshot in the Digest State singleton

readDigestState/writeDigestState over a one-row \"Digest State\" Airtable
table: read parses the Snapshot JSON (miss/parse-error → {}), write
get-or-creates the row, stamping Snapshot + Updated At. Slice 1, M5.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**Component 2 reviewer notes:** Surprises and contracts later components rely on. (1) The fake base needs NO extension — `makeFakeBase`'s `tableFn` lazily `ensure()`s any table name, so the spaced literal `"Digest State"` works as a seed key and as a live table name with no special-casing; seed `{ "Digest State": [...] }` for the pre-existing-row case, omit it (or seed `[]`) for the create case. (2) Because the fake ignores `filterByFormula`, `readDigestState`/`writeDigestState` deliberately do a `maxRecords:1` unfiltered select and take `rows[0]` — this is correctness-by-design (single-row table), not a fake limitation; the same idiom mirrors `listAllReports`. (3) The injected timestamp is the **third positional arg** `updatedAt: string = new Date().toISOString()` — C3's `runDigest` wiring should thread the `today` clock it already captures (`const today = new Date()`) as `today.toISOString()` so the write timestamp matches the digest's idempotency date; if C3 prefers a different signature (e.g. an options object), reconcile here. (4) `writeDigestState` issues **two** Airtable calls (a select-then-update/create) — `base.__calls` will contain a leading `select` before the `create`/`update`; assertions use `.find(c => c.kind === ...)`, not index 0, so this is robust, but C3's end-to-end run test should expect the extra read in the call log. (5) The Airtable "Digest State" table (fields `Snapshot` long-text, `Updated At` dateTime) must exist live before C3's wired path runs against the real base — that schema creation is out of this code task (spec §5: created via MCP before slice 1 merges); track it as a deploy precondition. (6) Names C3 depends on, exactly: `DIGEST_STATE_TABLE`, `readDigestState(base)`, `writeDigestState(base, snap, updatedAt?)`, and the `DigestSnapshot` shape from C1.

---

## Component 3: Wire + render — collectAttention IO wrapper + runDigest integration + attentionSection grouping/badging

I have everything I need. The codebase uses `console.warn(\`⚠ ...\`)` for caught-and-degraded paths. Now I'll draft the Component 3 plan tasks, grounded in the actual code I've read.

Key grounding facts I'll honor:

- `runDigest` builds `sites` as `new Map(websites.map((w) => [w.id, w]))` and threads `options.baseUrl`. Component 3's `collectAttention(deps)` is a separate IO wrapper that re-fetches and builds `sitesById` itself (per the shared contract), but inside `runDigest` I can pass the already-fetched data to avoid double-fetch — I'll follow the contract's `collectAttention(deps)` signature where deps carries `base` + `baseUrl`, fetching once.
- The fake base does NOT evaluate `filterByFormula`; `listAllReports`/`listWebsites` page once.
- `AttentionItem` currently has only `{ kind, title, url? }` — Component 1 extends it. Component 3 consumes the extended type. I'll write to the extended shape.
- The email-safety pins, https-only guard, and "all clear" line must stay green.

---

### Task 3.1: `collectAttention(deps)` IO wrapper — fetch once, build `sitesById`, run both collectors isolated

**Files:**

- Modify: `src/reports/digest.ts` (add `collectAttention` + its `CollectAttentionDeps` type; import the two collectors + `ReportRow`/`WebsiteRow` — `listAllReports`, `listWebsites` already imported)
- Test: `tests/reports/digest-collect.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/digest-collect.test.ts
import { describe, it, expect, vi } from "vitest";
import { collectAttention } from "../../src/reports/digest.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";

const BASE_URL = "https://reddoor-maintenance.netlify.app";

function vulnSite(): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: { Name: "Acme Co", url: "https://acme.example.com", "Security Vulns Critical": 2 },
  };
}

/** A bounced report on a site that exists — collectDeliveryFailures should keep it. */
function bouncedReport(): FakeRecord {
  return {
    id: "rec_report_bounced",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-06",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Delivery status": "bounced",
    },
  };
}

describe("collectAttention", () => {
  it("fetches once, builds sitesById, and merges both collectors' items", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    const keys = items.map((i) => i.key).sort();
    expect(keys).toContain("vuln:rec_site_acme");
    expect(keys).toContain("delivery:rec_report_bounced");
  });

  it("isolates a failing collector: a throw in one yields [] for it, the other still returns", async () => {
    const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSite()] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Force collectVulnAlerts to throw; collectDeliveryFailures must still contribute.
    const collectors = await import("../../src/alerts/digest-collectors.js");
    vi.spyOn(collectors, "collectVulnAlerts").mockImplementation(() => {
      throw new Error("vuln collector boom");
    });
    const items = await collectAttention({ base, baseUrl: BASE_URL });
    expect(items.map((i) => i.key)).toEqual(["delivery:rec_report_bounced"]);
    expect(items.some((i) => i.kind === "vuln")).toBe(false);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/digest-collect.test.ts -t "fetches once"`
      Expected: FAIL with `collectAttention is not a function` (not yet exported from digest.ts)
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/digest.ts — add the import near the other airtable imports (top of file)
import { collectVulnAlerts, collectDeliveryFailures } from "../alerts/digest-collectors.js";
import type { WebsiteRow } from "./airtable/websites.js";

// ── collectAttention (IO wrapper, sibling to runDigest) ──────────────────────

export type CollectAttentionDeps = {
  base: AirtableBase;
  /** Same DASHBOARD_BASE_URL value runDigest threads; used for the /s/<slug> links. */
  baseUrl: string;
};

/** Run a single collector under a try/catch: a thrown collector logs and yields []
 *  so one broken signal never blanks the whole "Needs attention" section. */
function runCollector(label: string, fn: () => AttentionItem[]): AttentionItem[] {
  try {
    return fn();
  } catch (e) {
    console.warn(`⚠ attention collector "${label}" failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Fetch the free signals once (listAllReports + listWebsites), build the
 * sitesById map the delivery collector needs, and run each pure collector
 * isolated. Returns the union of items; diffing/badging happens in runDigest.
 */
export async function collectAttention(deps: CollectAttentionDeps): Promise<AttentionItem[]> {
  const [reports, websites] = await Promise.all([
    listAllReports(deps.base),
    listWebsites(deps.base),
  ]);
  const sitesById = new Map<string, WebsiteRow>(websites.map((w) => [w.id, w]));
  return [
    ...runCollector("vuln", () => collectVulnAlerts(websites, deps.baseUrl)),
    ...runCollector("delivery", () => collectDeliveryFailures(reports, sitesById, deps.baseUrl)),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/digest-collect.test.ts`
      Expected: PASS (both items present; isolated-failure test shows only the delivery item + a `console.warn`)
- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest-collect.test.ts && git commit -m "feat(alerts): collectAttention IO wrapper — fetch once, isolate failing collectors"
```

---

### Task 3.2: Wire `collectAttention` → `readDigestState` → `diffAttention` → render → `writeDigestState` into `runDigest`

**Files:**

- Modify: `src/reports/digest.ts` (lines ~163–183: replace `const needsAttention: AttentionItem[] = []`, thread the diff, write state back after the send)
- Test: `tests/reports/digest-run.test.ts` (add cases to the existing `describe("runDigest")` block)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/digest-run.test.ts — add inside describe("runDigest", ...)
// helpers near the top of the file (alongside siteRow/readyReport):

/** A site carrying a critical vuln — collectVulnAlerts flags it. */
function vulnSiteRow(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_site_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      "Security Vulns Critical": 1,
      ...over,
    },
  };
}

/** A bounced report — collectDeliveryFailures flags it. */
function bouncedReport(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "rec_report_bounced",
    fields: {
      "Report ID": "Acme Co — Maintenance — 2026-06",
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Delivery status": "bounced",
      ...over,
    },
  };
}

// ── attention wiring ─────────────────────────────────────────────────────────

it("surfaces a vuln + a delivery item, both NEW, on the first run (no prior state)", async () => {
  const base = makeFakeBase({
    Reports: [bouncedReport()],
    Websites: [vulnSiteRow()],
    // "Digest State" absent → readDigestState returns {} → everything NEW
  });
  const { client, captured } = captureClient();
  const result = await runDigest({
    base,
    resend: client,
    baseUrl: "https://reddoor-maintenance.netlify.app",
  });
  expect(result.code).toBe(0);
  expect(captured).toHaveLength(1);
  const html = captured[0]!.html;
  expect(html).toContain("Needs attention");
  // Both signals present and badged NEW on first sight.
  expect(html).toContain("Acme Co");
  expect(html).toMatch(/NEW/);
  expect(html).not.toMatch(/all clear/i);
});

it("sends the digest on attention alone, even with nothing pending approval", async () => {
  // No ready reports — only a vuln. The no-noise skip must NOT fire.
  const base = makeFakeBase({ Reports: [], Websites: [vulnSiteRow()] });
  const { client, captured } = captureClient();
  const result = await runDigest({
    base,
    resend: client,
    baseUrl: "https://reddoor-maintenance.netlify.app",
  });
  expect(result.code).toBe(0);
  expect(captured).toHaveLength(1);
  expect(captured[0]!.html).toContain("Acme Co");
});

it("writes the next snapshot to Digest State after sending", async () => {
  const base = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSiteRow()] });
  const { client } = captureClient();
  await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
  // A create OR update against "Digest State" must have happened (singleton get-or-create).
  const stateWrites = base.__calls.filter(
    (c) => c.table === "Digest State" && (c.kind === "create" || c.kind === "update"),
  );
  expect(stateWrites.length).toBeGreaterThanOrEqual(1);
  const row = base.__records.get("Digest State")!.at(-1)!;
  const snap = JSON.parse(String(row.fields["Snapshot"]));
  expect(snap["vuln:rec_site_acme"]).toBeDefined();
  expect(snap["delivery:rec_report_bounced"]).toBeDefined();
});

it("second run with prior state seeded shows STANDING (no NEW/WORSE badge)", async () => {
  const prior = JSON.stringify({
    "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
    "delivery:rec_report_bounced": { metric: 1, firstFlaggedAt: "2026-06-10" },
  });
  const base = makeFakeBase({
    Reports: [bouncedReport()],
    Websites: [vulnSiteRow()],
    "Digest State": [{ id: "rec_state", fields: { Snapshot: prior } }],
  });
  const { client, captured } = captureClient();
  await runDigest({ base, resend: client, baseUrl: "https://reddoor-maintenance.netlify.app" });
  const html = captured[0]!.html;
  expect(html).toContain("Acme Co"); // standing problem still rendered
  expect(html).not.toMatch(/\bNEW\b/);
  expect(html).not.toMatch(/\bWORSE\b/);
});

it("a state write failure is caught and logged; the run still reports success", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const good = makeFakeBase({ Reports: [bouncedReport()], Websites: [vulnSiteRow()] });
  // Poison only the "Digest State" writes (create+update both throw).
  const poisoned = new Proxy(good, {
    apply(_t, _this, [name]: [string]) {
      const tbl = good(name);
      if (name === "Digest State") {
        return {
          ...tbl,
          create: async () => {
            throw new Error("state write down");
          },
          update: async () => {
            throw new Error("state write down");
          },
        };
      }
      return tbl;
    },
  });
  const { client, captured } = captureClient();
  const result = await runDigest({
    base: poisoned as unknown as typeof good,
    resend: client,
    baseUrl: "https://reddoor-maintenance.netlify.app",
  });
  expect(result.code).toBe(0); // the email already went out
  expect(captured).toHaveLength(1);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/digest-run.test.ts -t "surfaces a vuln"`
      Expected: FAIL — `needsAttention` is still hard-coded `[]`, so the html contains "all clear" and no "Acme Co"/"NEW" in the attention section (and the state-write/STANDING cases fail too)
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/digest.ts — add the import near collectVulnAlerts/collectDeliveryFailures import
import { diffAttention, readDigestState, writeDigestState } from "../alerts/digest-state.js";

// inside runDigest, REPLACE the hard-coded seam (currently lines ~163-164):
//
//   // M5 fills this; M3 ships it empty (renders the "all clear" line).
//   const needsAttention: AttentionItem[] = [];
//
// WITH:

// M5: collect the free signals (isolated), diff against yesterday's snapshot.
const collected = await collectAttention({ base, baseUrl: options.baseUrl });
const prior = await readDigestState(base);
const { tagged, next } = diffAttention(collected, prior, digestDateKey(today));
const needsAttention = tagged;
```

```ts
// src/reports/digest.ts — after the successful send, BEFORE `return { output: ... }`
// (currently the block ending at line ~183), persist the next snapshot. A write
// failure is caught + logged: the digest already went out, tomorrow re-news at worst.

try {
  await writeDigestState(base, next);
} catch (e) {
  console.warn(`⚠ digest state write failed: ${(e as Error).message}`);
}
return { output: `Digest sent to ${to.join(", ")} (${result.messageId})`, code: 0 };
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/digest-run.test.ts`
      Expected: PASS (all existing runDigest tests stay green; the new vuln/delivery/NEW/STANDING/state-write cases pass). Note: the existing "skips when nothing pending" tests still pass because their seeds carry no vulns and no bounced reports → `collectAttention` returns `[]` → no-noise skip still fires.
      **REQUIRED for spec §10 — also write state on the no-noise skip path.** The M3 skip (`if (readyForYourYes.length === 0 && needsAttention.length === 0) return { output: "Digest skipped…", code: 0 }`) returns BEFORE the post-send write-back. On a skip, `collected` is `[]` so `next` is `{}` — and that `{}` must still be persisted, otherwise a problem that resolves on a quiet day (digest skips, snapshot keeps the stale key) then recurs would diff as STANDING, not NEW. So write `next` on the skip path too (the send-failure path must NOT write — the outer `catch` returns `code: 1` with no write, preserving the NEW badge for the retry). Add this just before the skip return:

```ts
// src/reports/digest.ts — in the no-noise skip branch, persist the (now-empty)
// snapshot so resolved keys clear. Wrapped: a write failure can't fail the skip.
if (readyForYourYes.length === 0 && needsAttention.length === 0) {
  try {
    await writeDigestState(base, next);
  } catch (e) {
    console.warn(`⚠ digest state write failed: ${(e as Error).message}`);
  }
  return { output: "Digest skipped (nothing ready, nothing needs attention).", code: 0 };
}
```

Add a test pinning it:

```ts
it("clears a resolved key from the snapshot even when the digest skips (no-noise)", async () => {
  // prior had a vuln; today nothing is flagged and nothing is ready → skip, but the
  // snapshot must be written back EMPTY so a later recurrence diffs as NEW (spec §10).
  const prior = JSON.stringify({
    "vuln:rec_site_acme": { metric: 1, firstFlaggedAt: "2026-06-10" },
  });
  const base = makeFakeBase({
    Reports: [],
    Websites: [cleanSiteRow()], // no vulns now
    "Digest State": [{ id: "rec_state", fields: { Snapshot: prior } }],
  });
  const { client, captured } = captureClient();
  const result = await runDigest({
    base,
    resend: client,
    baseUrl: "https://reddoor-maintenance.netlify.app",
  });
  expect(result.output).toMatch(/skipped/i);
  expect(captured).toHaveLength(0); // no email
  const row = base.__records.get("Digest State")!.at(-1)!;
  expect(JSON.parse(String(row.fields["Snapshot"]))).toEqual({}); // resolved key cleared
});
```

(`cleanSiteRow()` = a `vulnSiteRow()` with `securityVulnsCritical`/`High` both `0` — add the helper next to `vulnSiteRow()`.)

- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest-run.test.ts && git commit -m "feat(alerts): wire collectAttention + diff + state write-back into runDigest"
```

---

### Task 3.3: `attentionSection` — group by site, severity-order within site, NEW/WORSE badging

**Files:**

- Modify: `src/reports/digest.ts` (lines 82–100: rewrite `attentionSection`; keep the https-only guard, the table layout, and the empty "all clear" line)
- Test: `tests/reports/digest.test.ts` (add render cases to the existing `describe("renderDigestHtml")` block)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/digest.test.ts — add inside describe("renderDigestHtml", ...)
// (the existing `sections()` helper builds AttentionItem-shaped rows; the new
//  fields key/siteName/severity/metric/status come from Component 1's extended type.)

it("groups two attention items under one site heading", () => {
  const html = renderDigestHtml(
    sections({
      readyForYourYes: [],
      needsAttention: [
        {
          key: "vuln:s1",
          kind: "vuln",
          siteName: "Acme Co",
          title: "2 critical/high vulns",
          url: "https://reddoor-maintenance.netlify.app/s/acme-co",
          severity: "critical",
          metric: 2,
          status: "new",
        },
        {
          key: "delivery:r1",
          kind: "delivery",
          siteName: "Acme Co",
          title: "report bounced",
          url: "https://reddoor-maintenance.netlify.app/s/acme-co",
          severity: "warning",
          metric: 1,
          status: "standing",
        },
      ],
    }),
  );
  // One site heading, both titles under it.
  expect((html.match(/Acme Co/g) ?? []).length).toBeGreaterThanOrEqual(1);
  expect(html).toContain("2 critical/high vulns");
  expect(html).toContain("report bounced");
  // critical sorts before warning within the site → vuln title appears first.
  expect(html.indexOf("2 critical/high vulns")).toBeLessThan(html.indexOf("report bounced"));
});

it("badges NEW and WORSE from item.status, omits a badge for standing", () => {
  const html = renderDigestHtml(
    sections({
      readyForYourYes: [],
      needsAttention: [
        {
          key: "vuln:s1",
          kind: "vuln",
          siteName: "Acme Co",
          title: "new vuln",
          severity: "critical",
          metric: 1,
          status: "new",
        },
        {
          key: "vuln:s2",
          kind: "vuln",
          siteName: "Beta Ltd",
          title: "worse vuln",
          severity: "critical",
          metric: 5,
          status: "worse",
        },
        {
          key: "vuln:s3",
          kind: "vuln",
          siteName: "Gamma Inc",
          title: "standing vuln",
          severity: "warning",
          metric: 1,
          status: "standing",
        },
      ],
    }),
  );
  expect(html).toMatch(/NEW/);
  expect(html).toMatch(/WORSE/);
  // The standing row carries neither badge token adjacent to its title.
  const standingRow = html.slice(html.indexOf("standing vuln") - 60, html.indexOf("standing vuln"));
  expect(standingRow).not.toMatch(/\bNEW\b|\bWORSE\b/);
});

it("WORSE badge when a metric climbs (status='worse' rendered as WORSE)", () => {
  const html = renderDigestHtml(
    sections({
      readyForYourYes: [],
      needsAttention: [
        {
          key: "vuln:s1",
          kind: "vuln",
          siteName: "Acme Co",
          title: "5 critical/high vulns",
          severity: "critical",
          metric: 5,
          status: "worse",
        },
      ],
    }),
  );
  expect(html).toContain("5 critical/high vulns");
  expect(html).toMatch(/WORSE/);
});

it("still emits no href for a non-https attention url after grouping (XSS guard holds)", () => {
  const html = renderDigestHtml(
    sections({
      readyForYourYes: [],
      needsAttention: [
        {
          key: "vuln:s1",
          kind: "vuln",
          siteName: "Acme Co",
          title: "bad-link",
          url: "javascript:alert(1)",
          severity: "critical",
          metric: 1,
          status: "new",
        },
      ],
    }),
  );
  expect(html).toContain("bad-link");
  expect(html).not.toContain("href");
  expect(html).not.toContain("javascript:");
});
```

> Note: Component 1 extends `AttentionItem` with `key/kind(union)/siteName/severity/metric/status`. The existing pinned tests `"renders Needs-attention items..."` and `"does not emit an href when AttentionItem.url is not https://"` (digest.test.ts lines 53–81) pass `{ kind: "tracking-issue", title, url }` shapes that now miss the new required fields — update those two existing fixtures in this step to the full shape (e.g. add `key`, `siteName: "X"`, `severity: "warning"`, `metric: 1`) so they typecheck and keep their assertions. Their assertions (`daily-reports-failing` rendered, `javascript:` produces no href) stay unchanged.

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm exec vitest run tests/reports/digest.test.ts -t "groups two attention items"`
      Expected: FAIL — the current `attentionSection` renders a flat list with no per-site heading ordering and no NEW/WORSE badge, so the grouping/badge assertions fail (the severity-order `indexOf` and the `/NEW/`,`/WORSE/` matches)
- [ ] **Step 3: Write minimal implementation**

```ts
// src/reports/digest.ts — REPLACE the whole attentionSection function (lines 82-100):

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1 };

/** Render the per-item status badge ("NEW"/"WORSE"); standing items get nothing. */
function attentionBadge(status?: AttentionStatus): string {
  if (status === "new")
    return `<strong style="color:${RED};font-family:helvetica,sans-serif">NEW</strong> `;
  if (status === "worse")
    return `<strong style="color:${RED};font-family:helvetica,sans-serif">WORSE</strong> `;
  return "";
}

function attentionSection(items: AttentionItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }

  // Group by siteName, preserving first-seen site order; sort within a site by
  // severity (critical first).
  const bySite = new Map<string, AttentionItem[]>();
  for (const it of items) {
    const bucket = bySite.get(it.siteName);
    if (bucket) bucket.push(it);
    else bySite.set(it.siteName, [it]);
  }

  const groups = [...bySite.entries()]
    .map(([siteName, siteItems]) => {
      const sorted = [...siteItems].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
      const rows = sorted
        .map((it) => {
          const safeUrl = it.url?.startsWith("https://") ? it.url : undefined;
          const titleHtml = safeUrl
            ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">${esc(it.title)}</a>`
            : esc(it.title);
          return `
          <tr>
            <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">${attentionBadge(it.status)}${titleHtml}</td>
          </tr>`;
        })
        .join("");
      return `
      <tr>
        <td style="color:#222;font-family:helvetica,sans-serif;font-size:16px;font-weight:700;padding:8px 0 4px">${esc(siteName)}</td>
      </tr>
      ${rows}`;
    })
    .join("");

  return `${heading}<table role="presentation" style="border-collapse:collapse;margin:0">${groups}</table>`;
}
```

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm exec vitest run tests/reports/digest.test.ts`
      Expected: PASS — grouping, severity order, NEW/WORSE badges, the https guard, the "all clear" empty line, and the three email-safety pins (`charset`, `width="600"`, `font-family:helvetica`) all stay green
- [ ] **Step 5: Commit**

```bash
git add src/reports/digest.ts tests/reports/digest.test.ts && git commit -m "feat(alerts): group attention items by site, severity-order, badge NEW/WORSE"
```

---

### Task 3.4: Full-suite green gate + lint

**Files:**

- Test: whole suite (no new files)

- [ ] **Step 1: Write the failing test**
      (No new test — this is the integration gate. Skip to Step 2.)
- [ ] **Step 2: Run the full reports + alerts suites**
      Run: `pnpm exec vitest run tests/reports tests/alerts`
      Expected: PASS — all `runDigest`, `renderDigestHtml`, collector, and state tests green together; the pre-existing email-safety pins and https guards unchanged
- [ ] **Step 3: Lint (CI prettier-checks every file, including this plan's touched .ts)**
      Run: `pnpm lint`
      Expected: clean (auto-fix locally rather than burning a CI cycle — repo memory: run `pnpm lint` before pushing)
- [ ] **Step 4: Confirm no leftover `needsAttention: AttentionItem[] = []` seam**
      Run: `grep -n "needsAttention" src/reports/digest.ts`
      Expected: `needsAttention` now bound to `tagged`, no hard-coded `[]`
- [ ] **Step 5: Commit (only if lint applied fixes)**

```bash
git add -A && git commit -m "style(alerts): prettier pass on M5 wire+render slice" || echo "nothing to commit"
```

---

**Component 3 reviewer notes:** Current-code surprises and downstream contracts. (1) `runDigest` already fetches `listWebsites` once and builds a `Map(w.id → w)` for the ready-section (digest.ts:146–147); `collectAttention(deps)` per the shared contract re-fetches independently — so wiring it in means a SECOND `listWebsites`/`listAllReports` round-trip per run. That is the contract's chosen shape (a self-contained, separately-testable IO wrapper) and the fleet's tables are small, but a reviewer may flag the double-fetch; if we wanted to dedupe, `runDigest` would have to pass its already-loaded `websites`/`pending`+`listAllReports` down, breaking the `collectAttention(deps)` signature — I kept the contract. (2) The no-noise skip at digest.ts:167 keys off `needsAttention.length`; binding it to `tagged` means a fleet with a standing vuln but nothing pending now SENDS daily — intended (success criteria §10: "no new signal silently drops"), and pinned by the "sends on attention alone" test, but it changes the steady-state email cadence, so worth calling out. (3) `collectAttention` and the state write-back read/write a `"Digest State"` table the fake only knows about if seeded; the live table must exist before merge (Component 2 / spec §5 creates it via MCP) — `readDigestState` must get-or-create the singleton and parse-miss → `{}`, or first real run throws. (4) The fake base does NOT evaluate `filterByFormula`, so `readDigestState` must fetch the singleton by paging (not a formula) or the test would see all rows regardless — Component 2 owns that, but C2's "second run STANDING" test depends on `readDigestState` returning exactly the seeded `Snapshot` JSON. (5) Names later/sibling components depend on, now load-bearing: `collectAttention(deps: { base, baseUrl })` exported from `src/reports/digest.ts`; the extended `AttentionItem`/`AttentionSeverity`/`AttentionStatus` from Component 1; `collectVulnAlerts`/`collectDeliveryFailures` from `src/alerts/digest-collectors.js`; `diffAttention`/`readDigestState`/`writeDigestState` from `src/alerts/digest-state.js`; the table name string `"Digest State"` and field `"Snapshot"`. (6) The existing digest.test.ts fixtures at lines 53–81 pass the OLD 3-field `AttentionItem` shape and will fail to typecheck once Component 1 adds required fields — Task C3 Step 1 updates them in place (keeping their assertions); if Component 1 makes the new fields optional instead, that update is unnecessary, so confirm Component 1's required-vs-optional decision before executing C3.

---

## Slices 2 & 3 (sketch — separate later plans)

These extend the same framework slice 1 builds (collectors → `AttentionItem[]` → `diffAttention` → grouped/badged render). Each is its own brainstorm-light spec + plan + PR.

**Slice 2 — Renovate-failing-CI.** Adapt the shipped `collectRenovateFailures(sites, probe)` (`src/alerts/renovate.ts`, #156) into an `AttentionItem[]` collector (`key: renovate:<repo>#<pr>`, `metric: 1`, `severity: warning`, `url: pr.url`, `siteName` from the finding's `site`). The probe is `makeGitHub({ token }).openPullRequests`, so the digest step needs a **fleet-read GH token** — decide `RENOVATE_TOKEN` (org secret, already present) vs a new scoped read PAT, and add it to the `report --digest` step's `env` in `daily-reports.yml`. Surface `result.skipped` repos as a low-severity "couldn't check" note (don't hide gaps). No new state shape — rides the same snapshot.

**Slice 3 — Lighthouse regression.** A `collectLighthouseAlerts(sites, baseUrl)` reading the per-site `pScore`/`rScore`/`bpScore`/`seoScore`. Dual trigger (research §7): an **absolute floor** (start ~80 to match the ~78 fleet baseline, ratchet toward 90) and a **≥5-pt regression** vs the prior run — the regression delta is exactly what the `DigestSnapshot` `metric` already enables (store the score as `metric`; "worse" = dropped ≥5). Threshold values are a Tucker decision at that slice's brainstorm.
