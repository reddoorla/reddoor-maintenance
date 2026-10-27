# Cockpit three-band severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cockpit's binary verdict (green / red) with a three-band severity model — 🔴 Broken, 🟡 Watch, 🔵 Waiting on your yes — so a self-patching CVE and a degrading site read as amber "watch" instead of hiding under `✓ All clear` or shouting the same red as a real outage.

**Architecture:** Two pure render-layer functions change. `buildNeedsYouFeed` ([`src/dashboard/fleet-cockpit.ts`](../../../src/dashboard/fleet-cockpit.ts)) re-buckets sites into `broken | watch | approval` (the new `watch` band absorbs self-patching vulns + the entire former watch tier). `verdictBar` ([`src/dashboard/fleet-render.ts`](../../../src/dashboard/fleet-render.ts)) becomes a four-state, worst-band-wins glance. No Airtable/schema changes, no new collectors, no change to `assignTier`. Design spec: [`docs/superpowers/specs/2026-06-29-cockpit-three-band-severity-design.md`](../specs/2026-06-29-cockpit-three-band-severity-design.md).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, server-rendered HTML template strings. Run tests with `pnpm vitest run <path>`.

---

## File Structure

- **Modify** `src/dashboard/fleet-cockpit.ts` — `NeedsYouGroup` type, `NEEDS_YOU_GROUP_RANK`, the `Acc` shape, and the `buildNeedsYouFeed` bucketing loop. (Task 1)
- **Modify** `src/dashboard/fleet-render.ts` — feed group label/order/dot (Task 1, to keep the build green after the type change); then the `verdictBar` four-state rewrite + verdict CSS (Task 2).
- **Modify** `tests/dashboard/fleet-cockpit.test.ts` — flip the now-changed `buildNeedsYouFeed` expectations + add new band cases. (Task 1)
- **Modify** `tests/dashboard/fleet-render.test.ts` — flip the verdict-bar expectations + add amber/blue state cases. (Task 2)

Task 1 keeps `verdictBar` untouched (still binary, still called as `verdictBar(model, feed.length)`), so the repo compiles and every verdict test still passes at Task 1's commit. Task 2 then upgrades only `verdictBar`.

---

## Task 1: Re-bucket the Needs-you feed into broken / watch / approval

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts` (type line 178, rank line 194, docstring 196-202, `Acc` 204-230, attention loop 232-246, group line 257)
- Modify: `src/dashboard/fleet-render.ts` (label 126-130, groups array line 136, dot CSS line 95)
- Test: `tests/dashboard/fleet-cockpit.test.ts`

### Step 1: Update the existing `buildNeedsYouFeed` tests to the new behavior

In `tests/dashboard/fleet-cockpit.test.ts`, **replace** the test at lines 464-474 (`"excludes a vuln until auto-fix is exhausted"`) with:

```ts
it("routes a self-patching vuln to watch and an exhausted vuln to broken", () => {
  const inflight = buildNeedsYouFeed(
    feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: false })])] }),
  );
  expect(inflight).toHaveLength(1);
  expect(inflight[0]!.group).toBe("watch");
  const stuck = buildNeedsYouFeed(
    feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: true })])] }),
  );
  expect(stuck).toHaveLength(1);
  expect(stuck[0]!.group).toBe("broken");
});
it("keeps a hard-broken site broken and omits its self-patching vuln from the reasons", () => {
  const feed = buildNeedsYouFeed(
    feedModel({ cards: [attnCard("Acme", [ci("Acme"), vuln("Acme", { exhausted: false })])] }),
  );
  expect(feed).toHaveLength(1);
  expect(feed[0]!.group).toBe("broken");
  expect(feed[0]!.reasons).toEqual(["CI red"]);
});
```

**Replace** the test at lines 486-493 (`"a watch site with a pending report collapses to one approval row"`) with:

```ts
it("a watch site with a pending report collapses to one watch row (worst band wins)", () => {
  const feed = buildNeedsYouFeed(
    feedModel({ cards: [watchCard("Delta", ["Performance 70"])], pending: [pending("Delta")] }),
  );
  expect(feed).toHaveLength(1);
  expect(feed[0]!.group).toBe("watch");
  expect(feed[0]!.reasons).toEqual(["Performance 70", "Maintenance 2026-Q2 ready"]);
});
```

**Replace** the test at lines 500-505 (`"surfaces a watch site as slipping"`) with:

```ts
it("surfaces a watch-tier site as watch", () => {
  const feed = buildNeedsYouFeed(feedModel({ cards: [watchCard("Gamma", ["Performance 68"])] }));
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({ group: "watch", siteName: "Gamma" });
  expect(feed[0]!.reasons).toEqual(["Performance 68"]);
});
```

**Replace** the ordering test at lines 506-519 with:

```ts
it("orders broken → watch → approval, critical-first within broken, then by name", () => {
  const feed = buildNeedsYouFeed(
    feedModel({
      cards: [
        watchCard("Zeta", ["SEO 80"]),
        attnCard("Delta", [delivery("Delta")]),
        attnCard("Apex", [ci("Apex")]),
      ],
      pending: [pending("Yara")],
    }),
  );
  expect(feed.map((f) => f.siteName)).toEqual(["Apex", "Delta", "Zeta", "Yara"]);
  expect(feed.map((f) => f.group)).toEqual(["broken", "broken", "watch", "approval"]);
});
```

### Step 2: Run the cockpit tests to verify the four edited tests fail

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts`

Expected: FAIL — the new expectations (`group: "watch"`, the broken/watch/approval ordering, the inflight-vuln row) don't match the current `slipping`/gated behavior. Other tests in the file still pass.

### Step 3: Update the `NeedsYouGroup` type, rank, and `Acc` shape in `fleet-cockpit.ts`

Replace line 178:

```ts
export type NeedsYouGroup = "broken" | "watch" | "approval";
```

Replace the `NEEDS_YOU_GROUP_RANK` at line 194:

```ts
const NEEDS_YOU_GROUP_RANK: Record<NeedsYouGroup, number> = { broken: 0, watch: 1, approval: 2 };
```

Replace the docstring block at lines 196-202 with:

```ts
/**
 * Collapse the cockpit model into a per-site "Needs you" feed — ONE row per site,
 * with every reason combined. PURE. A non-exhausted vuln is amber `watch` (the fleet
 * is auto-patching it); an exhausted vuln (`item.autoFixExhausted`) is a hard `broken`
 * break, as is any non-vuln attention item. The whole watch tier folds into `watch`.
 * Order: broken → watch → approval; within broken, critical-first; then site name.
 */
```

In the `Acc` type (lines 204-212), replace `slipping: boolean;` so the block reads:

```ts
type Acc = {
  slug: string;
  siteName: string;
  reasons: string[];
  hasCritical: boolean;
  broken: boolean;
  watch: boolean;
  approval: boolean;
};
```

In the `get` initializer (lines 218-226), replace `slipping: false,` with `watch: false,` so the new-Acc literal reads:

```ts
a = {
  slug,
  siteName,
  reasons: [],
  hasCritical: false,
  broken: false,
  watch: false,
  approval: false,
};
```

### Step 4: Rewrite the attention/watch bucketing loop and the group resolution

Replace the card loop at lines 232-246 with:

```ts
for (const card of model.cards) {
  if (card.tier === "attention") {
    // A self-patching vuln (present but not yet exhausted) is amber WATCH — the fleet
    // is auto-patching it. Every other item, INCLUDING an exhausted vuln, is a hard
    // break. A site with any hard break is broken and its self-patching vulns are not
    // separately listed (it is already red).
    const hardBroken = card.items.filter(
      (it) => !(it.kind === "vuln" && it.autoFixExhausted !== true),
    );
    const selfPatchingVulns = card.items.filter(
      (it) => it.kind === "vuln" && it.autoFixExhausted !== true,
    );
    if (hardBroken.length > 0) {
      const a = get(card.site.name);
      for (const it of hardBroken) {
        a.reasons.push(it.title);
        if (it.severity === "critical") a.hasCritical = true;
      }
      a.broken = true;
    } else if (selfPatchingVulns.length > 0) {
      const a = get(card.site.name);
      for (const it of selfPatchingVulns) a.reasons.push(it.title);
      a.watch = true;
    }
  } else if (card.tier === "watch" && card.watchReasons.length > 0) {
    const a = get(card.site.name);
    for (const r of card.watchReasons) a.reasons.push(r);
    a.watch = true;
  }
}
```

Replace the group resolution at line 257:

```ts
const group: NeedsYouGroup = a.broken ? "broken" : a.watch ? "watch" : "approval";
```

(The `model.pending` loop and the final `.sort()` are unchanged — the sort already keys off `NEEDS_YOU_GROUP_RANK`, `hasCritical`, then name.)

### Step 5: Update the feed group label, order, and dot in `fleet-render.ts` (keeps the build green)

Replace `NEEDS_YOU_GROUP_LABEL` at lines 126-130:

```ts
const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  watch: "Watch",
  approval: "Waiting on your yes",
};
```

Replace the groups array at line 136:

```ts
const groups: NeedsYouGroup[] = ["broken", "watch", "approval"];
```

Replace the dot CSS at line 95 (the amber `#f59e0b` swatch is unchanged — only the class name moves from `slipping` to `watch`):

```ts
.dot.watch { background:#f59e0b; }
```

### Step 6: Run the cockpit tests + typecheck to verify green

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts tests/dashboard/fleet-render.test.ts`
Expected: PASS — all cockpit tests pass with the new bands; the render tests still pass (verdictBar is still binary and the feed labels it asserts — "Waiting on your yes" — are unchanged).

Run: `pnpm typecheck`
Expected: PASS — no `NeedsYouGroup` exhaustiveness errors remain (no `"slipping"` left in any `Record<NeedsYouGroup, …>`).

### Step 7: Commit

```bash
git add src/dashboard/fleet-cockpit.ts src/dashboard/fleet-render.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(cockpit): add the amber Watch band to the Needs-you feed

Self-patching vulns (auto-fix not yet exhausted) and the whole watch tier
now bucket as 'watch' instead of being gated off the feed / labelled
'slipping'. NeedsYouGroup is broken|watch|approval. verdictBar stays binary
for now (Task 2)."
```

---

## Task 2: Four-state worst-band-wins verdict bar

**Files:**

- Modify: `src/dashboard/fleet-render.ts` (verdict CSS 74-81, `verdictBar` 98-124, caller line 381)
- Test: `tests/dashboard/fleet-render.test.ts`

### Step 1: Update the verdict-bar tests to the four-state behavior

In `tests/dashboard/fleet-render.test.ts`, **replace** the test at lines 269-298 (`"shows the per-site need count when something is wrong"`) with:

```ts
it("shows the blue waiting state when only an approval is pending", () => {
  const m = buildCockpitModel(
    [siteRow({ id: "recSITE", name: "Acme" })],
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
  expect(html).toContain('class="verdict soft"');
  expect(html).toContain("1 waiting on you");
  expect(html).not.toContain("✓ All clear");
});
```

**Replace** the test at lines 302-335 (`"sums the per-site Needs-you count across slipping + approval sites"`) with:

```ts
it("shows the amber watch headline when a watch site outranks a pending approval", () => {
  // Mid (watch-band Lighthouse → watch) + Acme (pending approval → blue) + Good
  // (healthy). Worst band is watch → amber headline; the approval + healthy counts
  // ride in the meta line.
  const m = buildCockpitModel(
    [
      siteRow({ id: "w", name: "Mid", pScore: 80 }),
      siteRow({ id: "recSITE", name: "Acme" }),
      siteRow({ id: "g", name: "Good" }),
    ],
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
  expect(html).toContain('class="verdict watch"');
  expect(html).toContain("1 site to watch");
  expect(html).toContain("1 waiting on you");
  expect(html).toContain("1 healthy");
  expect(html).not.toContain("✓ All clear");
});
```

**Replace** the test at lines 597-603 (`"renders the warn verdict when a site is on the Needs-you feed"`) with:

```ts
it("renders the amber watch verdict when a watch-band site is the worst", () => {
  const html = renderCockpitHtml(model([siteRow({ id: "w", name: "Mid", pScore: 80 })]));
  expect(html).toContain('class="verdict watch"');
  expect(html).toContain("1 site to watch");
  expect(html).not.toContain("✓ All clear");
});

it("renders the red broken verdict for a sub-floor Lighthouse site", () => {
  const html = renderCockpitHtml(model([siteRow({ id: "b", name: "Down", pScore: 40 })]));
  expect(html).toContain('class="verdict warn"');
  expect(html).toMatch(/⚠ 1 site broken/);
  expect(html).not.toContain("✓ All clear");
});
```

(The `"renders the ok verdict when nothing needs attention"` test at lines 591-595 is unchanged — green still triggers on an empty feed.)

### Step 2: Run the render tests to verify the edited verdict tests fail

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`
Expected: FAIL — the current binary `verdictBar` emits `class="verdict warn"` + `⚠ N sites need you` for every feed, so it never produces `verdict soft`, `verdict watch`, or the `to watch` / `waiting on you` copy.

### Step 3: Add per-band counts + the four-state `verdictBar`

In `src/dashboard/fleet-render.ts`, **replace** the entire `verdictBar` function (lines 98-124) with the helper + rewrite below:

```ts
/** Per-band site counts for the verdict, derived from the Needs-you feed. PURE. */
function needsYouCounts(feed: NeedsYouItem[]): {
  broken: number;
  watch: number;
  approval: number;
} {
  let broken = 0;
  let watch = 0;
  let approval = 0;
  for (const i of feed) {
    if (i.group === "broken") broken++;
    else if (i.group === "watch") watch++;
    else approval++;
  }
  return { broken, watch, approval };
}

/** The glance verdict — worst band wins. Green "✓ All clear" on an empty feed; else
 *  red (any broken), amber (watch, nothing broken), or blue (only approvals). Every
 *  lower band's count + the healthy count ride in the meta line (zero terms omitted),
 *  followed by the audit-recency suffix. Houses the ↻ Audit button + live panel. */
function verdictBar(model: CockpitModel, feed: NeedsYouItem[]): string {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const auditedTerm = auditedIso
    ? `fleet last audited ${escapeHtml(relativeTimeFromNow(auditedIso))}`
    : null;
  const total = model.cards.length;
  const { broken, watch, approval } = needsYouCounts(feed);
  const healthy = total - (broken + watch + approval);
  const actions = `<div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Audit fleet</button>
      <div id="rf-status" class="rf-status" aria-live="polite"></div>
    </div>`;
  const render = (cls: string, line: string, terms: Array<string | null>): string =>
    `<div class="verdict ${cls}">
    <div class="verdict-line">${line}</div>
    <div class="verdict-meta">${terms.filter(Boolean).join(" · ")}</div>
    ${actions}
  </div>`;

  if (broken === 0 && watch === 0 && approval === 0) {
    const sitesWord = `${total} site${total === 1 ? "" : "s"}`;
    return render("ok", "✓ All clear", [`${sitesWord} healthy`, auditedTerm]);
  }

  const watchTerm = watch > 0 ? `${watch} watching` : null;
  const approvalTerm = approval > 0 ? `${approval} waiting on you` : null;
  const healthyTerm = healthy > 0 ? `${healthy} healthy` : null;

  if (broken > 0) {
    return render("warn", `⚠ ${broken} site${broken === 1 ? "" : "s"} broken`, [
      watchTerm,
      approvalTerm,
      healthyTerm,
      auditedTerm,
    ]);
  }
  if (watch > 0) {
    return render("watch", `${watch} site${watch === 1 ? "" : "s"} to watch`, [
      approvalTerm,
      healthyTerm,
      auditedTerm,
    ]);
  }
  return render("soft", `${approval} waiting on you`, [healthyTerm, auditedTerm]);
}
```

### Step 4: Point the caller at the feed and add the verdict CSS

Replace the caller at line 381:

```ts
  ${verdictBar(model, feed)}
```

Add the amber + blue verdict colors. After the `.verdict.warn .verdict-meta` rule (line 80), insert:

```ts
.verdict.watch { background:#fff4e5; color:#a65a00; }
.verdict.watch .verdict-meta { color:#a65a00; opacity:0.85; }
.verdict.soft { background:#e7f1ff; color:#1c5d99; }
.verdict.soft .verdict-meta { color:#1c5d99; opacity:0.85; }
```

Replace the dark-mode verdict line (line 81) to add the two new bands:

```ts
@media (prefers-color-scheme: dark) { .verdict.ok { background:#10240f; color:#7fce85; } .verdict.warn { background:#2a0f0d; color:#ff8a80; } .verdict.watch { background:#2a2410; color:#ffd454; } .verdict.soft { background:#0f1d2a; color:#7fb6e8; } }
```

### Step 5: Run the render tests to verify green

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`
Expected: PASS — `verdict soft` / `verdict watch` / `verdict warn` and the `to watch` / `waiting on you` / `N broken` copy now render per band.

### Step 6: Commit

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): four-state worst-band-wins verdict bar

Verdict goes from binary green/red to green (all clear) / blue (waiting on
your yes) / amber (watch) / red (broken), with lower-band + healthy counts in
the meta line. Adds .verdict.watch and .verdict.soft colors."
```

---

## Task 3: Full verification gate

**Files:** none (verification only)

### Step 1: Run the full test suite

Run: `pnpm test`
Expected: PASS — whole suite green, no regressions outside the two touched files.

### Step 2: Lint, typecheck, build, and dist-test (the full pre-merge gate)

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test:dist`
Expected: all PASS. (`test:dist` and `typecheck` together catch a renamed/removed public export or an `.mts` handler break — `build` alone does not.)

### Step 3: Eyeball the rendered HTML for each band (optional but recommended)

Run a quick Node snippet (or extend a scratch test) that calls `renderCockpitHtml` with: an empty feed (green `✓ All clear`), a pending-only model (blue `waiting on you`), a `pScore: 80` site (amber `to watch`), and a `pScore: 40` site (red `broken`). Confirm each emits the matching `class="verdict …"` and headline copy.

### Step 4: Final commit (only if Step 3 produced a committable scratch artifact — otherwise skip)

No code changes expected here; Tasks 1-2 are the deliverable.

---

## Self-Review notes (already reconciled)

- **Spec coverage:** three-band model (Task 1) · self-patching-vuln→watch + exhausted→broken gate flip (Task 1 Step 4) · watch-tier→watch wholesale (Task 1 Step 4) · four verdict states + meta line + CSS (Task 2) · feed Watch group label/order/dot (Task 1 Step 5) · `assignTier`/`SiteCard` untouched (no task changes them) · tests for every band + ordering + boundary (Tasks 1-2 Step 1).
- **Type consistency:** `NeedsYouGroup = "broken" | "watch" | "approval"` used identically in the type, `NEEDS_YOU_GROUP_RANK`, `NEEDS_YOU_GROUP_LABEL`, the groups array, and `needsYouCounts`. `verdictBar(model, feed)` signature matches its only caller (line 381). `NeedsYouItem` shape is unchanged.
- **No `slipping` left:** every reference found (`fleet-cockpit.ts` 178/194/201/211/225/244/257, `fleet-render.ts` 95/129/136, both test files) is reassigned in Task 1 or Task 2.
