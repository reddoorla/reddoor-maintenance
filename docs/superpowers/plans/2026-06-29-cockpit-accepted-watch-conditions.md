# Cockpit accepted Watch conditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator mark a watch condition on a site as "accepted" (via a new Airtable `Accepted Watch Conditions` field) so it drops out of the cockpit's amber Watch band + verdict, while a worsening still re-alarms and the condition stays visible as a muted chip.

**Architecture:** A new `acceptedWatchConditions: string[]` field on `WebsiteRow` is read by the pure `assignTier` ([fleet-cockpit.ts](../../../src/dashboard/fleet-cockpit.ts)), which routes an accepted watch reason to a new `acceptedReasons` list instead of `watchReasons`. An all-accepted site becomes `tier: "healthy"`, so the existing three-band feed/verdict drop it with no change. The reasons surface as a muted `.chip.accepted` on the Fleet-browse card. Sub-floor (broken) Lighthouse is unaffected (it arrives as an `AttentionItem`, not a watch reason), so acceptance never hides a real regression.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, server-rendered template strings. Run tests with `pnpm vitest run <path>`.

Design spec: [docs/superpowers/specs/2026-06-29-cockpit-accepted-watch-conditions-design.md](../specs/2026-06-29-cockpit-accepted-watch-conditions-design.md).

---

## File Structure

- **Modify** `src/reports/airtable/websites.ts` — add the `acceptedWatchConditions` field to `WebsiteRow` + `mapRow`. (Task 1)
- **Modify** `tests/_helpers/website-row.ts` — default the new field to `[]` in `makeWebsiteRow`. (Task 1)
- **Modify** `src/dashboard/fleet-cockpit.ts` — `assignTier` suppression + `acceptedReasons` (Task 1); `SiteCard` field + `buildCockpitModel` wiring (Task 2).
- **Modify** `src/dashboard/fleet-browse-render.ts` — render the muted accepted chip. (Task 2)
- **Modify** `src/dashboard/fleet-render.ts` — `.chip.accepted` CSS. (Task 2)
- **Modify** `tests/dashboard/fleet-cockpit.test.ts` — `assignTier` suppression tests. (Task 1)
- **Modify** `tests/dashboard/fleet-render.test.ts` — integration test (suppressed from feed + chip rendered). (Task 2)

`websites-mapping.test.ts` is NOT touched — it uses per-field assertions, so the additive `mapRow` field doesn't affect it.

---

## Task 1: `assignTier` suppresses accepted watch conditions

**Files:**

- Modify: `src/reports/airtable/websites.ts` (`WebsiteRow` type line 64; `mapRow` line 241)
- Modify: `tests/_helpers/website-row.ts` (default near line 30)
- Modify: `src/dashboard/fleet-cockpit.ts` (`assignTier` lines 68-105)
- Test: `tests/dashboard/fleet-cockpit.test.ts`

### Step 1: Plumb the `acceptedWatchConditions` field (so test fixtures compile)

In `src/reports/airtable/websites.ts`, add to the `WebsiteRow` type immediately after the `reportRecipientsCc: string | null;` line:

```ts
  acceptedWatchConditions: string[];
```

In the same file, in `mapRow`, add immediately after the `reportRecipientsCc: (f["Report recipients (CC)"] as string | undefined) ?? null,` line:

```ts
    acceptedWatchConditions: (f["Accepted Watch Conditions"] as string[] | undefined) ?? [],
```

In `tests/_helpers/website-row.ts`, add to the returned default object immediately after the `reportRecipientsCc: null,` line:

```ts
    acceptedWatchConditions: [],
```

### Step 2: Run typecheck to confirm the plumbing compiles

Run: `pnpm typecheck`
Expected: PASS — the field is additive; `assignTier` doesn't use it yet.

### Step 3: Write the failing `assignTier` tests

In `tests/dashboard/fleet-cockpit.test.ts`, inside the existing `describe("assignTier", …)` block, add these tests:

```ts
it("routes an accepted Lighthouse watch category to acceptedReasons and stays healthy", () => {
  const r = assignTier(site({ bpScore: 78, acceptedWatchConditions: ["Best Practices"] }), [], NOW);
  expect(r.tier).toBe("healthy");
  expect(r.watchReasons).toEqual([]);
  expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
});

it("still watches an un-accepted Lighthouse category", () => {
  const r = assignTier(site({ bpScore: 78 }), [], NOW);
  expect(r.tier).toBe("watch");
  expect(r.watchReasons).toEqual(["Best Practices 78"]);
  expect(r.acceptedReasons).toEqual([]);
});

it("keeps watching an un-accepted reason while accepting another on the same site", () => {
  const r = assignTier(
    site({
      bpScore: 78,
      lastCommitAt: "2026-04-01T00:00:00Z",
      acceptedWatchConditions: ["Best Practices"],
    }),
    [],
    NOW,
  );
  expect(r.tier).toBe("watch");
  expect(r.watchReasons).not.toContain("Best Practices 78");
  expect(r.watchReasons.some((x) => x.startsWith("last commit"))).toBe(true);
  expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
});

it("accepts the stale-repo condition", () => {
  const r = assignTier(
    site({ lastCommitAt: "2026-04-01T00:00:00Z", acceptedWatchConditions: ["stale repo"] }),
    [],
    NOW,
  );
  expect(r.tier).toBe("healthy");
  expect(r.acceptedReasons.some((x) => x.startsWith("last commit"))).toBe(true);
});

it("accepts the no-custom-domain condition", () => {
  const r = assignTier(
    site({
      status: "maintenance",
      url: "https://foo.netlify.app/",
      acceptedWatchConditions: ["no custom domain"],
    }),
    [],
    NOW,
  );
  expect(r.tier).toBe("healthy");
  expect(r.acceptedReasons).toContain("on *.netlify.app (no custom domain)");
});

it("matches accepted conditions case-insensitively", () => {
  const r = assignTier(site({ bpScore: 78, acceptedWatchConditions: ["best practices"] }), [], NOW);
  expect(r.tier).toBe("healthy");
  expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
});

it("does not list an accepted condition that isn't currently active", () => {
  const r = assignTier(site({ bpScore: 95, acceptedWatchConditions: ["Best Practices"] }), [], NOW);
  expect(r.tier).toBe("healthy");
  expect(r.acceptedReasons).toEqual([]);
});

it("returns empty acceptedReasons when the site has attention items", () => {
  const r = assignTier(site({ acceptedWatchConditions: ["Best Practices"] }), [item()], NOW);
  expect(r.tier).toBe("attention");
  expect(r.acceptedReasons).toEqual([]);
});
```

### Step 4: Run the new tests to verify they fail

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts`
Expected: FAIL — `assignTier` doesn't return `acceptedReasons` yet (it's `undefined`), and accepted conditions still land in `watchReasons`.

### Step 5: Implement the suppression in `assignTier`

In `src/dashboard/fleet-cockpit.ts`, replace the entire `assignTier` function (the docstring above it through its closing brace) with:

```ts
/**
 * Tier a single site from its attention items + soft watch rules. PURE; `now` is
 * injected for testability. Any attention item → 🔴 attention (items already encode
 * the M5 thresholds, so a sub-75 Lighthouse score arrives here as an item and never
 * needs the watch band). A FAILED latest production deploy (`deployStatus === "failed"`/
 * "error") is the same severity → 🔴 attention. Otherwise 🟡 watch when a Lighthouse
 * category sits in [75,85), the last commit to `main` is older than 30 days, or a
 * maintenance site is still on `*.netlify.app`. Else 🟢 healthy.
 *
 * A condition the operator has marked accepted (`site.acceptedWatchConditions`,
 * case-insensitive: a Lighthouse category label, "stale repo", or "no custom domain")
 * is routed to `acceptedReasons` instead of `watchReasons` — it leaves the watch band
 * (an all-accepted site becomes healthy) but stays visible as a muted chip. Acceptance
 * is watch-only: a sub-floor Lighthouse score arrives as an AttentionItem above and
 * still alarms broken, so accepting "78" never hides a drop to "72".
 *
 * `watchReasons` are the human labels for the card; `watchSignals` are the STRUCTURED
 * filter tags ("lighthouse" / "stale") the client filter keys off.
 */
export function assignTier(
  site: WebsiteRow,
  items: AttentionItem[],
  now: Date,
): { tier: Tier; watchReasons: string[]; watchSignals: string[]; acceptedReasons: string[] } {
  if (items.length > 0)
    return { tier: "attention", watchReasons: [], watchSignals: [], acceptedReasons: [] };
  // A failed latest production deploy is an active break — tier it 🔴 attention, the
  // same severity a sub-floor Lighthouse score gets (which arrives as an item above).
  if (isFailedDeployStatus(site.deployStatus))
    return { tier: "attention", watchReasons: [], watchSignals: [], acceptedReasons: [] };

  // Conditions the operator has reviewed and accepted (case-insensitive). An accepted
  // watch reason is routed to acceptedReasons instead of raising the watch band.
  const accepted = new Set(site.acceptedWatchConditions.map((c) => c.toLowerCase()));
  const watchReasons: string[] = [];
  const acceptedReasons: string[] = [];
  const signals = new Set<string>();
  for (const cat of WATCH_CATEGORIES) {
    const score = site[cat.field];
    if (score !== null && score >= LIGHTHOUSE_FLOOR && score < LIGHTHOUSE_WATCH_HIGH) {
      const reason = `${cat.label} ${score}`;
      if (accepted.has(cat.label.toLowerCase())) {
        acceptedReasons.push(reason);
      } else {
        watchReasons.push(reason);
        signals.add("lighthouse");
      }
    }
  }
  if (site.lastCommitAt !== null) {
    const ageMs = now.getTime() - Date.parse(site.lastCommitAt);
    if (Number.isFinite(ageMs) && ageMs > STALE_DAYS * MS_PER_DAY) {
      const reason = `last commit ${relativeTimeFromNow(site.lastCommitAt, now)}`;
      if (accepted.has("stale repo")) {
        acceptedReasons.push(reason);
      } else {
        watchReasons.push(reason);
        signals.add("stale");
      }
    }
  }
  // A live (maintenance) site still served from *.netlify.app never got a custom
  // domain — a launch-completeness gap. Only for maintenance: a launch-period site on
  // netlify.app is expected (not launched yet).
  if (site.status === "maintenance" && isNetlifyAppUrl(site.url)) {
    const reason = "on *.netlify.app (no custom domain)";
    if (accepted.has("no custom domain")) {
      acceptedReasons.push(reason);
    } else {
      watchReasons.push(reason);
      signals.add("no-domain");
    }
  }
  return watchReasons.length > 0
    ? { tier: "watch", watchReasons, watchSignals: [...signals], acceptedReasons }
    : { tier: "healthy", watchReasons: [], watchSignals: [], acceptedReasons };
}
```

### Step 6: Run the tests to verify they pass

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts`
Expected: PASS — all new `assignTier` tests pass; the existing tier tests still pass (default `acceptedWatchConditions: []` → today's behavior).

### Step 7: Commit

```bash
git add src/reports/airtable/websites.ts tests/_helpers/website-row.ts src/dashboard/fleet-cockpit.ts tests/dashboard/fleet-cockpit.test.ts
git commit -m "feat(cockpit): assignTier suppresses accepted watch conditions

A new acceptedWatchConditions field on WebsiteRow routes an accepted watch
reason (Lighthouse category / stale repo / no custom domain) to acceptedReasons
instead of watchReasons, so an all-accepted site goes healthy and leaves the
Watch band. Watch-only: a sub-floor Lighthouse score still alarms broken."
```

---

## Task 2: Thread `acceptedReasons` to the card + render the muted chip

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts` (`SiteCard` lines 107-118; `buildCockpitModel` lines 344-357)
- Modify: `src/dashboard/fleet-browse-render.ts` (`chips()` lines 135-147)
- Modify: `src/dashboard/fleet-render.ts` (`.chip` CSS near line 72)
- Test: `tests/dashboard/fleet-render.test.ts`

### Step 1: Write the failing integration test

In `tests/dashboard/fleet-render.test.ts`, add to the verdict-bar describe block (near the other `renderCockpitHtml` verdict tests):

```ts
it("an accepted Best-Practices watch leaves the band but shows a muted accepted chip", () => {
  const html = renderCockpitHtml(
    model([
      siteRow({
        id: "a",
        name: "Accepted",
        bpScore: 78,
        acceptedWatchConditions: ["Best Practices"],
      }),
    ]),
  );
  // Accepted → the site is healthy → verdict stays All clear (out of the Watch band)…
  expect(html).toContain('class="verdict ok"');
  expect(html).toContain("✓ All clear");
  // …but the condition is still on record as a muted chip.
  expect(html).toContain('class="chip accepted">✓ accepted: Best Practices 78');
});

it("the same BP-78 site shows the amber watch verdict when NOT accepted", () => {
  const html = renderCockpitHtml(model([siteRow({ id: "b", name: "Watched", bpScore: 78 })]));
  expect(html).toContain('class="verdict watch"');
  expect(html).not.toContain("chip accepted");
});
```

### Step 2: Run the test to verify it fails

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`
Expected: FAIL — `SiteCard` has no `acceptedReasons` (TS error in the renderer once referenced, or the chip is never emitted), so the `chip accepted` assertion fails.

### Step 3: Add `acceptedReasons` to `SiteCard` and wire `buildCockpitModel`

In `src/dashboard/fleet-cockpit.ts`, replace the `SiteCard` type (lines 107-118) with:

```ts
export type SiteCard = {
  site: WebsiteRow;
  tier: Tier;
  /** This site's tagged attention items (status already set), critical-first. */
  items: AttentionItem[];
  /** Why the site is on Watch — human labels (empty unless tier === "watch"). */
  watchReasons: string[];
  /** Structured watch tags ("lighthouse" / "stale") for the client filter. */
  watchSignals: string[];
  /** Watch reasons the operator has accepted: suppressed from the band, shown as a
   *  muted chip. Populated whenever the underlying condition is currently active. */
  acceptedReasons: string[];
  /** Count of NEW submissions for this site (optional; populated by buildCockpitModel). */
  newSubmissions?: number;
};
```

In the same file, replace the `buildCockpitModel` card construction (lines 344-357) with:

```ts
const cards: SiteCard[] = visible.map((site) => {
  const items = (bySite.get(site.name) ?? []).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const { tier, watchReasons, watchSignals, acceptedReasons } = assignTier(site, items, now);
  return {
    site,
    tier,
    items,
    watchReasons,
    watchSignals,
    acceptedReasons,
    newSubmissions: subCountBySite.get(site.id) ?? 0,
  };
});
```

### Step 4: Render the muted accepted chip

In `src/dashboard/fleet-browse-render.ts`, in `chips()`, add the accepted-chip loop immediately after the existing `watchReasons` loop (so the block reads):

```ts
for (const reason of c.watchReasons) items.push(`<span class="chip">${escapeHtml(reason)}</span>`);
for (const reason of c.acceptedReasons)
  items.push(`<span class="chip accepted">✓ accepted: ${escapeHtml(reason)}</span>`);
return items.length ? `<div class="chips">${items.join("")}</div>` : "";
```

In `src/dashboard/fleet-render.ts`, add the muted chip CSS immediately after the `.chip.stuck { … }` rule (line 72):

```ts
.chip.accepted { background:transparent; border:1px dashed #bbb; color:#888; }
@media (prefers-color-scheme: dark) { .chip.accepted { border-color:#444; color:#888; } }
```

### Step 5: Run the test to verify it passes

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts tests/dashboard/fleet-cockpit.test.ts`
Expected: PASS — the accepted site is `verdict ok` with a `chip accepted`; the un-accepted site is `verdict watch`.

### Step 6: Commit

```bash
git add src/dashboard/fleet-cockpit.ts src/dashboard/fleet-browse-render.ts src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(cockpit): show accepted watch conditions as a muted chip

SiteCard carries acceptedReasons; the Fleet-browse card renders each as a
muted '✓ accepted: …' chip so an accepted condition stays on record while it
leaves the alarm lane."
```

---

## Task 3: Full verification gate

**Files:** none (verification only)

### Step 1: Run the full test suite

Run: `pnpm test`
Expected: PASS — whole suite green, no regressions (the new field defaults to `[]` everywhere via `makeWebsiteRow`, so existing tiering tests are unaffected).

### Step 2: Lint, typecheck, build, dist-test

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test:dist`
Expected: all PASS.

---

## Rollout (controller steps, after merge — not code)

1. Create the `Accepted Watch Conditions` Airtable Websites field (`multipleSelects`) with options: `Performance`, `Accessibility`, `Best Practices`, `SEO`, `stale repo`, `no custom domain`. (Meta API if the PAT has `schema.bases:write`, else Airtable UI.)
2. Set `Accepted Watch Conditions = ["Best Practices"]` on the seven Vimeo-background sites: Data Dynamiq, Espada, Alamo Anatomy, MSOT, ERP, Vineyard, Revogen.
3. The change is live on the next `main` redeploy of the dashboard (ships dark until the field exists — `?? []` is a no-op beforehand).

---

## Self-Review notes (already reconciled)

- **Spec coverage:** field + mapping (T1 S1) · `assignTier` suppression + `acceptedReasons` + watch-only guarantee (T1 S5, tested incl. attention-item case) · case-insensitive (T1 tests) · not-active = no chip (T1 test) · `SiteCard` + `buildCockpitModel` wiring (T2 S3) · muted chip + CSS (T2 S4) · feed/verdict unchanged & accepted-site-absent-from-feed (T2 integration test asserts `verdict ok`) · rollout (controller section).
- **Type consistency:** `acceptedWatchConditions: string[]` (field) and `acceptedReasons: string[]` (computed) used identically across `WebsiteRow`, `assignTier` return, `SiteCard`, `buildCockpitModel`, and `chips()`. `assignTier`'s four return sites all include `acceptedReasons`.
- **No placeholders:** every step has exact paths + complete code + exact commands.
