# M4 Slice 2b — GitHub-signals consumer (cockpit lights up)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the GitHub signals slice 2a persists to Airtable into visible cockpit triage — Renovate-failing and default-branch-CI-red become 🔴 attention items (chips + NEW/WORSE badges + `prs`/`ci` filters); the real last-commit timestamp drives 🟡 deploy-staleness. Zero request-path GitHub calls (the cockpit reads only the persisted Websites fields slice 2a wrote).

**Architecture:** Two new pure collectors read the persisted `renovateFailingCis` / `defaultBranchCi` fields → `AttentionItem[]`. `buildCockpitModel` folds them into the existing tier/diff/summary machinery; `assignTier`'s Watch staleness switches from `lastLighthouseAuditAt`-age to the real `lastCommitAt`-age. The renderer gains `prs`/`ci` filter chips + summary counts; the cards render the new chips automatically (slice-1 `chips()`).

**Tech Stack:** TypeScript (ESM, `.js` specifiers), vitest. No new deps.

**Reference (real code this builds on):**

- `src/reports/digest.ts` — `AttentionItem` (kind union `"vuln"|"delivery"|"renovate"|"lighthouse"` → add `"ci"`).
- `src/alerts/digest-collectors.ts` — `collectVulnAlerts(sites, baseUrl)` is the exact pattern to mirror (`dashboardUrl` helper, `key: vuln:<id>`, severity/metric).
- `src/reports/airtable/websites.ts` — `WebsiteRow` now has `renovateFailingCis: number | null`, `defaultBranchCi: string | null`, `lastCommitAt: string | null` (from slice 2a, on main).
- `src/dashboard/fleet-cockpit.ts` — `buildCockpitModel` (the `rawItems` union, `assignTier`, `CockpitSummary`, `SiteCard`); slice 1's `assignTier` uses `lastLighthouseAuditAt` for staleness — this plan switches it to `lastCommitAt`.
- `src/dashboard/fleet-render.ts` — `FILTERS`, `signalsAttr`, `summaryBar`, `chips` (slice 1).

---

## File Structure

- **Modify** `src/reports/digest.ts` — add `"ci"` to `AttentionItem["kind"]`.
- **Modify** `src/alerts/digest-collectors.ts` — `collectRenovateAlerts`, `collectCiAlerts` (pure, read persisted fields).
- **Modify** `src/dashboard/fleet-cockpit.ts` — wire both collectors into `buildCockpitModel`; switch `assignTier` staleness to `lastCommitAt`; add `renovateFailing`/`ciRed` to `CockpitSummary`.
- **Modify** `src/dashboard/fleet-render.ts` — `FILTERS` += `prs`,`ci`; `signalsAttr` maps `renovate`→`prs`/`ci`→`ci`; summary headline shows the two counts.
- **Tests:** extend `tests/alerts/digest-collectors.test.ts`, `tests/dashboard/fleet-cockpit.test.ts`, `tests/dashboard/fleet-render.test.ts`.

---

## Task 1: `"ci"` attention kind + the two persisted-field collectors

**Files:** Modify `src/reports/digest.ts`, `src/alerts/digest-collectors.ts`; Test `tests/alerts/digest-collectors.test.ts`.

- [ ] **Step 1: Add `"ci"` to the kind union**

In `src/reports/digest.ts`, change `AttentionItem`'s `kind`:

```ts
  kind: "vuln" | "delivery" | "renovate" | "lighthouse" | "ci";
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/alerts/digest-collectors.test.ts` (reuses the file's existing `site(over)` factory + `BASE`):

```ts
import { collectRenovateAlerts, collectCiAlerts } from "../../src/alerts/digest-collectors.js";

describe("collectRenovateAlerts (persisted field)", () => {
  it("flags a site with failing Renovate PRs: key, kind, metric=count, warning, dashboard url", () => {
    const items = collectRenovateAlerts([site({ id: "rec1", name: "Acme Co", renovateFailingCis: 3 })], BASE);
    expect(items).toEqual([
      {
        key: "renovate:rec1",
        kind: "renovate",
        siteName: "Acme Co",
        title: "3 Renovate PRs failing CI",
        url: `${BASE}/s/acme-co`,
        severity: "warning",
        metric: 3,
      },
    ]);
  });

  it("singularizes one and skips zero/null", () => {
    expect(collectRenovateAlerts([site({ renovateFailingCis: 1 })], BASE)[0]!.title).toBe("1 Renovate PR failing CI");
    expect(collectRenovateAlerts([site({ renovateFailingCis: 0 })], BASE)).toEqual([]);
    expect(collectRenovateAlerts([site({ renovateFailingCis: null })], BASE)).toEqual([]);
  });
});

describe("collectCiAlerts (persisted field)", () => {
  it("flags a site whose default-branch CI is failing", () => {
    const items = collectCiAlerts([site({ id: "rec1", name: "Acme Co", defaultBranchCi: "failing" })], BASE);
    expect(items).toEqual([
      {
        key: "ci:rec1",
        kind: "ci",
        siteName: "Acme Co",
        title: "Default-branch CI failing",
        url: `${BASE}/s/acme-co`,
        severity: "warning",
        metric: 1,
      },
    ]);
  });

  it("ignores passing/pending/none/null", () => {
    for (const v of ["passing", "pending", "none", null]) {
      expect(collectCiAlerts([site({ defaultBranchCi: v })], BASE)).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- digest-collectors`
Expected: FAIL — `collectRenovateAlerts`/`collectCiAlerts` not exported.

- [ ] **Step 4: Implement**

In `src/alerts/digest-collectors.ts` (reuse the existing `dashboardUrl` helper), add:

```ts
/**
 * One attention item per site carrying failing Renovate PRs, read from the
 * slice-2a-persisted `renovateFailingCis` field (NOT the live sweep — that's
 * `renovateFindingsToAttention`, used by the digest). PURE. `metric` is the
 * count (a rising count diffs WORSE); severity `warning`. Null/0 → skipped.
 */
export function collectRenovateAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const n = s.renovateFailingCis ?? 0;
    if (n <= 0) continue;
    items.push({
      key: `renovate:${s.id}`,
      kind: "renovate",
      siteName: s.name,
      title: `${n} Renovate ${n === 1 ? "PR" : "PRs"} failing CI`,
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: n,
    });
  }
  return items;
}

/**
 * One attention item per site whose persisted default-branch CI rollup is
 * `failing` (slice 2a). PURE. `metric` 1 (binary); severity `warning`. Any other
 * state (passing/pending/none) or null is skipped.
 */
export function collectCiAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    if (s.defaultBranchCi !== "failing") continue;
    items.push({
      key: `ci:${s.id}`,
      kind: "ci",
      siteName: s.name,
      title: "Default-branch CI failing",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- digest-collectors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reports/digest.ts src/alerts/digest-collectors.ts tests/alerts/digest-collectors.test.ts
git commit -m "feat(cockpit): collectRenovateAlerts + collectCiAlerts read persisted GitHub signals"
```

---

## Task 2: Wire into `buildCockpitModel` + real-staleness `assignTier` + summary

**Files:** Modify `src/dashboard/fleet-cockpit.ts`; Test `tests/dashboard/fleet-cockpit.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dashboard/fleet-cockpit.test.ts` (reuses its `site`/`NOW`/`BASE` helpers):

```ts
describe("buildCockpitModel — GitHub signals (slice 2b)", () => {
  it("tiers a Renovate-failing site and a CI-red site as attention, and counts them", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Reno", renovateFailingCis: 2 }),
        site({ id: "b", name: "CiRed", defaultBranchCi: "failing" }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.find((c) => c.site.name === "Reno")!.tier).toBe("attention");
    expect(m.cards.find((c) => c.site.name === "CiRed")!.tier).toBe("attention");
    expect(m.summary).toMatchObject({ renovateFailing: 2, ciRed: 1, attention: 2 });
  });

  it("uses lastCommitAt (not audit age) for Watch staleness; null commit is not stale", () => {
    const stale = buildCockpitModel([site({ id: "s", name: "Stale", lastCommitAt: "2026-01-01T00:00:00Z" })], [], {}, BASE, NOW);
    expect(stale.cards[0]!.tier).toBe("watch");
    expect(stale.cards[0]!.watchSignals).toContain("stale");

    const noCommit = buildCockpitModel([site({ id: "n", name: "NoCommit", lastCommitAt: null })], [], {}, BASE, NOW);
    expect(noCommit.cards[0]!.tier).toBe("healthy");
  });
});
```

Also UPDATE the slice-1 `assignTier` staleness tests in this file that used `lastLighthouseAuditAt` for the stale case — change those fixtures to set `lastCommitAt` instead (search the file for `lastLighthouseAuditAt: "2026-04-01...` / the "older than 30 days" + "never-audited" assignTier tests and the fleet-render stale test). The Watch-via-Lighthouse-band tests are unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- fleet-cockpit`
Expected: FAIL — `renovateFailing`/`ciRed` absent on summary; staleness still keyed on audit age.

- [ ] **Step 3: Implement**

In `src/dashboard/fleet-cockpit.ts`:

(a) Import the new collectors:

```ts
import {
  collectVulnAlerts,
  collectDeliveryFailures,
  collectLighthouseAlerts,
  collectRenovateAlerts,
  collectCiAlerts,
} from "../alerts/digest-collectors.js";
```

(b) Add them to the `rawItems` union in `buildCockpitModel`:

```ts
  const rawItems: AttentionItem[] = [
    ...collectVulnAlerts(visible, baseUrl),
    ...collectLighthouseAlerts(visible, baseUrl),
    ...collectDeliveryFailures(reports, sitesById, baseUrl),
    ...collectRenovateAlerts(visible, baseUrl),
    ...collectCiAlerts(visible, baseUrl),
  ];
```

(c) Switch `assignTier`'s staleness from `lastLighthouseAuditAt` to `lastCommitAt` (rename the watch-reason label too):

```ts
  if (site.lastCommitAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastCommitAt);
    if (Number.isFinite(ageMs) && ageMs > AUDIT_STALE_DAYS * MS_PER_DAY) {
      watchReasons.push(`last commit ${relativeTimeFromNow(site.lastCommitAt, now)}`);
      signals.add("stale");
    }
  }
```

(Rename the `AUDIT_STALE_DAYS` constant to `STALE_DAYS` if you like; keep the value 30. Update its one reference.)

(d) Add the two counts to `CockpitSummary` (the type + the computed object):

```ts
  renovateFailing: number;
  ciRed: number;
```

```ts
    renovateFailing: tagged.filter((i) => i.kind === "renovate").reduce((s, i) => s + i.metric, 0),
    ciRed: tagged.filter((i) => i.kind === "ci").length,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-cockpit`
Expected: PASS (incl. the updated slice-1 staleness tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(cockpit): tier Renovate/CI signals + real lastCommit staleness + summary counts"
```

---

## Task 3: Renderer — `prs`/`ci` filters + chips + summary headline

**Files:** Modify `src/dashboard/fleet-render.ts`; Test `tests/dashboard/fleet-render.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dashboard/fleet-render.test.ts`:

```ts
describe("renderCockpitHtml — GitHub-signal chips & filters (slice 2b)", () => {
  it("renders prs/ci filter chips", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('data-filter="prs"');
    expect(html).toContain('data-filter="ci"');
  });

  it("a Renovate-failing card carries the prs signal + its chip", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "a", name: "Reno", renovateFailingCis: 2 })]));
    expect(html).toMatch(/data-signals="[^"]*prs[^"]*"/);
    expect(html).toMatch(/2 Renovate PRs failing CI/);
  });

  it("a CI-red card carries the ci signal + its chip", () => {
    const html = renderCockpitHtml(model([siteRow({ id: "b", name: "CiRed", defaultBranchCi: "failing" })]));
    expect(html).toMatch(/data-signals="[^"]*ci[^"]*"/);
    expect(html).toMatch(/Default-branch CI failing/);
  });

  it("the summary headline shows the PRs-failing and CI-red counts", () => {
    const html = renderCockpitHtml(
      model([siteRow({ id: "a", name: "Reno", renovateFailingCis: 2, defaultBranchCi: "failing" })]),
    );
    expect(html).toMatch(/2 PRs failing/);
    expect(html).toMatch(/1 CI red/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- fleet-render`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/dashboard/fleet-render.ts`:

(a) Extend `FILTERS`:

```ts
const FILTERS = ["all", "vulns", "lighthouse", "delivery", "prs", "ci", "stale", "pending"] as const;
```

(b) Map the new kinds in `signalsAttr` — `renovate` → `prs`, `ci` → `ci` (vuln stays `vulns`; lighthouse/delivery already map by kind):

```ts
function signalsAttr(c: SiteCard): string {
  const kinds = new Set<string>();
  for (const it of c.items) {
    kinds.add(it.kind === "vuln" ? "vulns" : it.kind === "renovate" ? "prs" : it.kind);
  }
  for (const sig of c.watchSignals) kinds.add(sig);
  return [...kinds].join(" ");
}
```

(c) Add the two counts to the `summaryBar` headline `heads` array (after the delivery entry):

```ts
    `${s.renovateFailing} PRs failing`,
    `${s.ciRed} CI red`,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- fleet-render`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): prs/ci filter chips, signal tags, and summary counts"
```

---

## Task 4: Changeset + final gate

- [ ] **Step 1: Changeset** — create `.changeset/m4-slice2b-consumer.md`:

```md
---
"@reddoorla/maintenance": minor
---

feat(cockpit): the cockpit now surfaces the GitHub-sourced signals (M4 slice 2b). Sites with Renovate update PRs failing CI or a red default-branch build join the 🔴 attention tier (chips + NEW/WORSE badges + new `prs`/`ci` filters), and the 🟡 Watch tier's staleness now uses the real last-commit-to-`main` timestamp (slice 2a) instead of the audit-age proxy. Pure collectors read the persisted Websites fields — still zero request-path GitHub calls. The summary bar gains "N PRs failing" / "N CI red" counts.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/m4-slice2b-consumer.md
git commit -m "chore(changeset): M4 slice 2b cockpit consumer"
```

- [ ] **Step 3: Final gate** (controller): `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist` → all green. Then the 3-lens review (spec / quality / a LIVE lens reading the cockpit model against the real Airtable rows slice 2a populated) before the head-SHA merge.

---

## Self-review

- **Spec coverage (§4):** `"ci"` kind + both collectors → Task 1; `buildCockpitModel`/`assignTier`/summary → Task 2; `prs`/`ci` filters + chips + counts → Task 3.
- **Type consistency:** `collectRenovateAlerts`/`collectCiAlerts` mirror `collectVulnAlerts`'s exact return shape; the kind `"ci"` is added to the union in Task 1 before any consumer uses it. `renovateFailing`/`ciRed` on `CockpitSummary` are set in Task 2 and read in Task 3.
- **Staleness migration:** Task 2 explicitly updates the slice-1 `assignTier` staleness tests (audit-age → `lastCommitAt`); the Lighthouse-band Watch tests are untouched.
- **No request-path GitHub:** the collectors read only `WebsiteRow` fields (persisted by 2a); nothing here calls GitHub.
