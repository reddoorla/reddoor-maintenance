# Vuln "Auto-Fix Exhausted" Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a distinct "auto-fix failed" dashboard signal when Renovate has been auto-dispatched ≥3 nightly cycles for the same critical/high vuln episode without clearing it.

**Architecture:** A per-site attempt counter (`Security Auto-Fix Attempts`, a Number field on the Airtable Websites row) is incremented on each real Renovate dispatch and reset to 0 when the vuln clears — its whole lifecycle owned by `renovate-dispatch` via pure functions. `collectVulnAlerts` reads the counter and, at/above the threshold, emits the existing `vuln` attention item in an "exhausted" flavor (same diff key, forced-critical severity, an `autoFixExhausted` flag). The renderer turns that flag into a distinct chip, a filter token, and a summary tally. Ships dark: until the field exists, reads coerce to 0 (signal never fires) and writes no-op (caught).

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest, Airtable JS SDK, changesets. Pure-core + thin-IO-shell idiom throughout.

**Spec:** `docs/superpowers/specs/2026-06-23-vuln-auto-fix-exhausted-signal-design.md`

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/reports/airtable/websites.ts` | `WebsiteRow` type, `mapRow`, per-field Airtable writers | Add `securityAutoFixAttempts` field + mapping + `updateAutoFixAttempts` writer |
| `tests/_helpers/website-row.ts` | Shared `WebsiteRow` test factory | Add the new field's null default |
| `src/github/renovate-dispatch.ts` | Renovate dispatch core (pure) | Add `computeAutoFixAttemptUpdates`, `applyAutoFixAttemptUpdates`, `formatAutoFixAttemptsSummary` |
| `src/cli/commands/renovate-dispatch.ts` | The `--fleet` command (IO shell) | Wire the counter updates after dispatch, best-effort |
| `src/alerts/attention.ts` | `AttentionItem` contract | Add optional `autoFixExhausted?: boolean` |
| `src/alerts/digest-collectors.ts` | M5 attention collectors (pure) | `collectVulnAlerts` exhausted flavor + threshold constant |
| `src/dashboard/fleet-cockpit.ts` | Cockpit model builder (pure) | `CockpitSummary.autoFixStuck` + tally |
| `src/dashboard/fleet-render.ts` | Cockpit HTML renderer | `signalsAttr` token, `FILTERS` chip, `chips()` class + style, summary head |

Tests live beside each in the mirrored `tests/` path.

---

## Task 1: Data model — counter field, mapping, writer

**Files:**
- Modify: `src/reports/airtable/websites.ts` (type near line 84, `mapRow` near line 236, add writer near line 506)
- Modify: `tests/_helpers/website-row.ts:41-44`
- Test: `tests/reports/airtable/websites-mapping.test.ts`, `tests/reports/airtable/update-auto-fix-attempts.test.ts` (create)

- [ ] **Step 1: Write the failing mapping test**

Append to `tests/reports/airtable/websites-mapping.test.ts` (inside the existing top-level `describe`, matching its style — check how a sibling numeric field like `Renovate Failing CIs` is asserted and mirror it):

```ts
it("maps Security Auto-Fix Attempts to securityAutoFixAttempts (number, null when absent)", () => {
  expect(mapRowForTest({ "Security Auto-Fix Attempts": 3 }).securityAutoFixAttempts).toBe(3);
  expect(mapRowForTest({}).securityAutoFixAttempts).toBeNull();
});
```

> Note: use whatever the file already uses to invoke `mapRow` (it may export a helper or test `listWebsites` against a fake base — match the existing pattern in that file rather than inventing `mapRowForTest`). If the file feeds rows through a fake base, build the fake record with `fields: { "Security Auto-Fix Attempts": 3 }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/reports/airtable/websites-mapping.test.ts`
Expected: FAIL — `securityAutoFixAttempts` is `undefined` / not on the type.

- [ ] **Step 3: Add the type field**

In `src/reports/airtable/websites.ts`, add to the `WebsiteRow` type right after `securityVulnsLow` (line 87):

```ts
  /** Count of consecutive nightly Renovate auto-fix dispatches for the CURRENT
   *  critical/high vuln episode that have NOT yet cleared it. Owned by
   *  `renovate-dispatch`: +1 per real dispatch, reset to 0 when vulns clear.
   *  Null = field absent / never dispatched → reads as 0. At/above
   *  AUTO_FIX_EXHAUSTED_CYCLES the vuln renders as "auto-fix failed". */
  securityAutoFixAttempts: number | null;
```

- [ ] **Step 4: Add the mapping**

In `mapRow`, right after the `securityVulnsLow` mapping (line 239):

```ts
    securityAutoFixAttempts: (f["Security Auto-Fix Attempts"] as number | undefined) ?? null,
```

- [ ] **Step 5: Add the factory default**

In `tests/_helpers/website-row.ts`, after `securityVulnsLow: null,` (line 44):

```ts
    securityAutoFixAttempts: null,
```

- [ ] **Step 6: Run the mapping test to verify it passes**

Run: `pnpm vitest run tests/reports/airtable/websites-mapping.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing writer test**

Create `tests/reports/airtable/update-auto-fix-attempts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateAutoFixAttempts } from "../../../src/reports/airtable/websites.js";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";

type UpdateCall = { table: string; id: string; fields: Record<string, unknown> };

function makeFakeBase(): { base: AirtableBase; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const tableFn = (table: string) => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const r of recs) calls.push({ table, id: r.id, fields: r.fields });
      return recs;
    },
  });
  return { base: tableFn as unknown as AirtableBase, calls };
}

describe("updateAutoFixAttempts", () => {
  it("writes the counter to the Security Auto-Fix Attempts field on the given row", async () => {
    const { base, calls } = makeFakeBase();
    await updateAutoFixAttempts(base, "recX", 3);
    expect(calls).toEqual([
      { table: "Websites", id: "recX", fields: { "Security Auto-Fix Attempts": 3 } },
    ]);
  });
});
```

> Confirm the table constant: this asserts `table: "Websites"`. If `WEBSITES_TABLE` differs, match its value.

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm vitest run tests/reports/airtable/update-auto-fix-attempts.test.ts`
Expected: FAIL — `updateAutoFixAttempts` is not exported.

- [ ] **Step 9: Add the writer**

In `src/reports/airtable/websites.ts`, after `updateSecurityCounts` (line 506):

```ts
/** Persist a site's auto-fix attempt counter. Its own one-field writer so the
 *  nightly Renovate dispatch can update it without touching the audit's counts. */
export async function updateAutoFixAttempts(
  base: AirtableBase,
  recordId: string,
  attempts: number,
): Promise<void> {
  await base(WEBSITES_TABLE).update([
    { id: recordId, fields: { "Security Auto-Fix Attempts": attempts } },
  ]);
}
```

- [ ] **Step 10: Run both tests to verify they pass**

Run: `pnpm vitest run tests/reports/airtable/websites-mapping.test.ts tests/reports/airtable/update-auto-fix-attempts.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/reports/airtable/websites.ts tests/_helpers/website-row.ts tests/reports/airtable/websites-mapping.test.ts tests/reports/airtable/update-auto-fix-attempts.test.ts
git commit -m "feat(security): add securityAutoFixAttempts field, mapping, and writer"
```

---

## Task 2: Pure core — planner, applier, summary

**Files:**
- Modify: `src/github/renovate-dispatch.ts`
- Test: `tests/github/renovate-dispatch.test.ts`

- [ ] **Step 1: Write the failing planner tests**

Append to `tests/github/renovate-dispatch.test.ts` (it already imports `makeWebsiteRow`; add the three new symbols to the existing import from `renovate-dispatch.js`):

```ts
describe("computeAutoFixAttemptUpdates", () => {
  const result = (over: Partial<RenovateDispatchResult> = {}): RenovateDispatchResult => ({
    dispatched: [],
    skipped: [],
    failed: [],
    ...over,
  });

  it("increments a dispatched vuln site (null counter reads as 0 → 1)", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsHigh: 2 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/a"] }))).toEqual([
      { id: "rA", attempts: 1 },
    ]);
  });

  it("increments from the existing counter value", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsCritical: 1, securityAutoFixAttempts: 2 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/a"] }))).toEqual([
      { id: "rA", attempts: 3 },
    ]);
  });

  it("resets to 0 when a previously-attempted site now has zero vulns", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsCritical: 0, securityVulnsHigh: 0, securityAutoFixAttempts: 4 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result())).toEqual([{ id: "rA", attempts: 0 }]);
  });

  it("leaves a skipped vuln site (healthy PR in flight) unchanged — no update emitted", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsHigh: 2, securityAutoFixAttempts: 1 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ skipped: ["reddoorla/a"] }))).toEqual([]);
  });

  it("leaves a failed-dispatch vuln site unchanged", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsHigh: 2, securityAutoFixAttempts: 1 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ failed: [{ repo: "reddoorla/a", error: "x" }] }))).toEqual([]);
  });

  it("emits no update when a clean site already sits at 0 (write-minimal)", () => {
    const sites = [
      makeWebsiteRow({ id: "rA", status: "maintenance", gitRepo: "reddoorla/a", securityVulnsHigh: 0, securityAutoFixAttempts: 0 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result())).toEqual([]);
  });

  it("excludes inactive and repo-less sites", () => {
    const sites = [
      makeWebsiteRow({ id: "rIn", status: null, gitRepo: "reddoorla/x", securityVulnsHigh: 5, securityAutoFixAttempts: 2 }),
      makeWebsiteRow({ id: "rNo", status: "maintenance", gitRepo: null, securityVulnsHigh: 5, securityAutoFixAttempts: 2 }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/x"] }))).toEqual([]);
  });
});

describe("applyAutoFixAttemptUpdates", () => {
  it("writes each update and counts successes; never throws on a writer error", async () => {
    const written: Array<{ id: string; attempts: number }> = [];
    const r = await applyAutoFixAttemptUpdates(
      [{ id: "rA", attempts: 1 }, { id: "rB", attempts: 0 }, { id: "rC", attempts: 3 }],
      async (id, attempts) => {
        if (id === "rB") throw new Error("field not found"); // e.g. column not yet created
        written.push({ id, attempts });
      },
    );
    expect(r).toEqual({ written: 2, failed: 1 });
    expect(written).toEqual([{ id: "rA", attempts: 1 }, { id: "rC", attempts: 3 }]);
  });

  it("is a no-op for an empty update list", async () => {
    let calls = 0;
    const r = await applyAutoFixAttemptUpdates([], async () => { calls++; });
    expect(r).toEqual({ written: 0, failed: 0 });
    expect(calls).toBe(0);
  });
});

describe("formatAutoFixAttemptsSummary", () => {
  it("emits a machine-readable counts line", () => {
    expect(formatAutoFixAttemptsSummary({ written: 2, failed: 1 })).toBe(
      "AUTO_FIX_ATTEMPTS_SUMMARY written=2 failed=1",
    );
  });
});
```

Update the import at the top of the test file to include the new symbols and the `RenovateDispatchResult` type:

```ts
import {
  selectRenovateTargets,
  dispatchRenovateAcross,
  formatRenovateDispatchSummary,
  hasHealthyRenovatePr,
  RENOVATE_WORKFLOW_FILE,
  computeAutoFixAttemptUpdates,
  applyAutoFixAttemptUpdates,
  formatAutoFixAttemptsSummary,
} from "../../src/github/renovate-dispatch.js";
import type { PullRequestSummary } from "../../src/github/gh.js";
import type { RenovateDispatchResult } from "../../src/github/renovate-dispatch.js";
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/github/renovate-dispatch.test.ts`
Expected: FAIL — the three new functions are not exported.

- [ ] **Step 3: Implement the three pure functions**

In `src/github/renovate-dispatch.ts`, after `formatRenovateDispatchSummary` (line 125). The file already imports `isDashboardVisible` and `WebsiteRow` (line 1):

```ts
/**
 * Plan the per-site auto-fix-attempt counter writes from a dispatch result. PURE.
 * For each active, repo-backed site:
 *   - vulns now 0                         → reset to 0   (episode resolved)
 *   - else dispatched this run            → attempts + 1 (a fresh failed-so-far attempt)
 *   - else (skipped / failed / untouched) → unchanged
 * Returns only the rows whose value CHANGES (a steady fleet writes nothing). A
 * skipped repo (healthy Renovate PR in flight) is NOT a failed attempt — a fix is
 * genuinely moving toward merge — so its counter holds.
 */
export function computeAutoFixAttemptUpdates(
  sites: WebsiteRow[],
  result: RenovateDispatchResult,
): { id: string; attempts: number }[] {
  const dispatched = new Set(result.dispatched);
  const updates: { id: string; attempts: number }[] = [];
  for (const s of sites) {
    if (!isDashboardVisible(s)) continue;
    const repo = s.gitRepo?.trim();
    if (!repo) continue;
    const current = s.securityAutoFixAttempts ?? 0;
    const vulns = (s.securityVulnsCritical ?? 0) + (s.securityVulnsHigh ?? 0);
    let next = current;
    if (vulns === 0) next = 0;
    else if (dispatched.has(repo)) next = current + 1;
    if (next !== current) updates.push({ id: s.id, attempts: next });
  }
  return updates;
}

/**
 * Apply the planned counter updates with an injected writer, BEST-EFFORT: a writer
 * that throws (e.g. the Airtable field not yet created, or a transient error) is
 * counted in `failed` and never propagates — the security sweep must not fail over
 * counter bookkeeping. Returns the applied/failed tallies for the summary line.
 */
export async function applyAutoFixAttemptUpdates(
  updates: { id: string; attempts: number }[],
  write: (id: string, attempts: number) => Promise<void>,
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const u of updates) {
    try {
      await write(u.id, u.attempts);
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
}

/** Machine-readable counts line the workflow can grep, mirroring RENOVATE_DISPATCH_SUMMARY. */
export function formatAutoFixAttemptsSummary(tally: { written: number; failed: number }): string {
  return `AUTO_FIX_ATTEMPTS_SUMMARY written=${tally.written} failed=${tally.failed}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/github/renovate-dispatch.test.ts`
Expected: PASS (all prior + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/github/renovate-dispatch.ts tests/github/renovate-dispatch.test.ts
git commit -m "feat(security): plan/apply/format auto-fix attempt counter (pure core)"
```

---

## Task 3: Command wiring — apply the counter after dispatch

**Files:**
- Modify: `src/cli/commands/renovate-dispatch.ts`
- Test: `tests/cli/renovate-dispatch-command.test.ts` (guards stay green; no new test — the happy path is covered by Task 2's pure helpers, matching the file's stated convention)

- [ ] **Step 1: Wire the counter updates into the command**

In `src/cli/commands/renovate-dispatch.ts`:

Extend the import from `renovate-dispatch.js` (lines 4-9) to add the three new symbols:

```ts
import {
  selectRenovateTargets,
  dispatchRenovateAcross,
  formatRenovateDispatchSummary,
  hasHealthyRenovatePr,
  computeAutoFixAttemptUpdates,
  applyAutoFixAttemptUpdates,
  formatAutoFixAttemptsSummary,
} from "../../github/renovate-dispatch.js";
```

Extend the import from `websites.js` (line 2) to add the writer:

```ts
import { listWebsites, updateAutoFixAttempts } from "../../reports/airtable/websites.js";
```

After the `for (const f of result.failed) lines.push(...)` loop and BEFORE `lines.push(formatRenovateDispatchSummary(result));` (lines 67-68), insert the counter step:

```ts
  // Update the auto-fix attempt counters from this run, best-effort: a write that
  // fails (e.g. the Airtable field not yet created) is tallied, never thrown — the
  // sweep must still exit 0. Uses the full `websites` list so 0-vuln sites reset.
  const attemptUpdates = computeAutoFixAttemptUpdates(websites, result);
  const attemptTally = await applyAutoFixAttemptUpdates(attemptUpdates, (id, attempts) =>
    updateAutoFixAttempts(base, id, attempts),
  );
```

Then add its summary line alongside the existing one (replace line 68's single push with both):

```ts
  lines.push(formatRenovateDispatchSummary(result));
  lines.push(formatAutoFixAttemptsSummary(attemptTally));
```

- [ ] **Step 2: Run the command guard tests (still green)**

Run: `pnpm vitest run tests/cli/renovate-dispatch-command.test.ts`
Expected: PASS — both guard branches (non-fleet → 2, no token → 0) unchanged.

- [ ] **Step 3: Typecheck the wiring**

Run: `pnpm typecheck`
Expected: PASS — no type errors (verifies the writer signature and tally types line up).

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/renovate-dispatch.ts
git commit -m "feat(security): apply auto-fix attempt counters on the nightly dispatch"
```

---

## Task 4: Signal flavor — exhausted vuln item

**Files:**
- Modify: `src/alerts/attention.ts:36-50`
- Modify: `src/alerts/digest-collectors.ts:34-58`
- Test: `tests/alerts/digest-collectors.test.ts`

- [ ] **Step 1: Write the failing collector tests**

Append to the existing `describe("collectVulnAlerts", ...)` block in `tests/alerts/digest-collectors.test.ts` (the file's `site()` helper + `BASE` are already defined):

```ts
  it("does NOT flag exhausted below the threshold (attempts 2 → normal vuln item)", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 1, securityVulnsHigh: 0, securityAutoFixAttempts: 2 })],
      BASE,
    );
    expect(items[0]!.autoFixExhausted).toBeUndefined();
    expect(items[0]!.title).toBe("1 critical/high vuln");
    expect(items[0]!.severity).toBe("critical");
  });

  it("flags exhausted at the threshold (attempts 3): forced-critical, flag set, escalated title", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 2, securityAutoFixAttempts: 3 })],
      BASE,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "vuln:rec_site_acme",
      kind: "vuln",
      severity: "critical", // forced critical even though it's high-only
      metric: 2,
      autoFixExhausted: true,
    });
    expect(items[0]!.title).toBe("2 critical/high vulns — auto-fix failed (3×)");
  });

  it("does not flag exhausted when there are no vulns even if a stale counter remains", () => {
    const items = collectVulnAlerts(
      [site({ securityVulnsCritical: 0, securityVulnsHigh: 0, securityAutoFixAttempts: 9 })],
      BASE,
    );
    expect(items).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/alerts/digest-collectors.test.ts`
Expected: FAIL — `autoFixExhausted` not on the item / title not escalated.

- [ ] **Step 3: Add the AttentionItem field**

In `src/alerts/attention.ts`, inside the `AttentionItem` type after `status?` (line 49):

```ts
  /** Set by collectVulnAlerts when Renovate's auto-fix has been retried past the
   *  exhaustion threshold without clearing the vuln. Drives a distinct "auto-fix
   *  failed" chip + filter token; absent on every other item and flavor. */
  autoFixExhausted?: boolean;
```

- [ ] **Step 4: Implement the exhausted flavor**

In `src/alerts/digest-collectors.ts`, add a threshold constant above `collectVulnAlerts` (after line 39's doc comment is fine; place it just before the function at line 40):

```ts
/** Renovate auto-fix dispatches for one vuln episode before it's "exhausted" (manual fix needed). */
const AUTO_FIX_EXHAUSTED_CYCLES = 3;
```

Replace the body of `collectVulnAlerts` (lines 40-58) with:

```ts
export function collectVulnAlerts(sites: WebsiteRow[], baseUrl: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    const critical = s.securityVulnsCritical ?? 0;
    const high = s.securityVulnsHigh ?? 0;
    const metric = critical + high;
    if (metric <= 0) continue;
    const attempts = s.securityAutoFixAttempts ?? 0;
    const exhausted = attempts >= AUTO_FIX_EXHAUSTED_CYCLES;
    const noun = metric === 1 ? "vuln" : "vulns";
    items.push({
      key: `vuln:${s.id}`,
      kind: "vuln",
      siteName: s.name,
      title: exhausted
        ? `${metric} critical/high ${noun} — auto-fix failed (${attempts}×)`
        : `${metric} critical/high ${noun}`,
      url: dashboardUrl(baseUrl, s.name),
      severity: exhausted || critical > 0 ? "critical" : "warning",
      metric,
      ...(exhausted ? { autoFixExhausted: true } : {}),
    });
  }
  return items;
}
```

> The `...(exhausted ? { autoFixExhausted: true } : {})` spread keeps the key ABSENT on non-exhausted items, so existing snapshot/equality tests in other suites stay stable. `metric` remains `critical + high` so the NEW/WORSE count diff is unchanged.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/alerts/digest-collectors.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the broader alerts/reports suites for regressions**

Run: `pnpm vitest run tests/alerts tests/reports/digest-collect.test.ts tests/reports/digest-run.test.ts`
Expected: PASS — no existing vuln-item assertion broke (the non-exhausted shape is byte-identical to before).

- [ ] **Step 7: Commit**

```bash
git add src/alerts/attention.ts src/alerts/digest-collectors.ts tests/alerts/digest-collectors.test.ts
git commit -m "feat(dashboard): collectVulnAlerts emits an auto-fix-exhausted vuln flavor"
```

---

## Task 5: Render & summary — chip, filter, tally

**Files:**
- Modify: `src/dashboard/fleet-cockpit.ts` (`CockpitSummary` line 117-129, `buildCockpitModel` summary line 253-264)
- Modify: `src/dashboard/fleet-render.ts` (`FILTERS` line 148-159, `summaryBar` heads line 163-171, `chips()` line 274-282, `signalsAttr` line 288-295, style block)
- Test: `tests/dashboard/fleet-cockpit.test.ts`, `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing summary + render tests**

Append to `tests/dashboard/fleet-cockpit.test.ts` (uses `buildCockpitModel`, `makeWebsiteRow`; check the file's existing `now`/baseUrl call convention and mirror it — e.g. `buildCockpitModel(sites, [], {}, BASE, NOW)`):

```ts
it("counts auto-fix-stuck sites in the summary", () => {
  const m = buildCockpitModel(
    [
      makeWebsiteRow({ id: "rS", name: "Stuck", status: "maintenance", securityVulnsCritical: 1, securityAutoFixAttempts: 3 }),
      makeWebsiteRow({ id: "rF", name: "Fresh", status: "maintenance", securityVulnsCritical: 1, securityAutoFixAttempts: 1 }),
    ],
    [],
    {},
    BASE,
    NOW,
  );
  expect(m.summary.autoFixStuck).toBe(1);
});
```

> Match `BASE`/`NOW` to whatever the file already declares at its top. If it constructs the model via a local helper, use that helper instead.

Append to `tests/dashboard/fleet-render.test.ts` (uses the `model([...])` + `siteRow({...})` helpers at the top of the file):

```ts
describe("renderCockpitHtml — auto-fix-exhausted vuln", () => {
  it("tags the card with the auto-fix-failed signal and a stuck chip", () => {
    const html = renderCockpitHtml(
      model([siteRow({ name: "Stuck Co", securityVulnsCritical: 2, securityAutoFixAttempts: 3 })]),
    );
    // data-signals carries BOTH the base vuln token and the new one
    expect(html).toMatch(/data-signals="[^"]*\bvulns\b[^"]*"/);
    expect(html).toMatch(/data-signals="[^"]*\bauto-fix-failed\b[^"]*"/);
    // the chip renders with the distinct stuck class + escalated text
    expect(html).toContain("chip critical stuck");
    expect(html).toContain("auto-fix failed (3×)");
  });

  it("offers an auto-fix-failed filter chip", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('data-filter="auto-fix-failed"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts tests/dashboard/fleet-render.test.ts`
Expected: FAIL — `summary.autoFixStuck` undefined; no `auto-fix-failed` token/chip/filter.

- [ ] **Step 3: Add the summary field + tally**

In `src/dashboard/fleet-cockpit.ts`, add to `CockpitSummary` after `ciRed` (line 124):

```ts
  /** Count of sites whose vuln has exhausted the Renovate auto-fix (manual fix needed). */
  autoFixStuck: number;
```

In `buildCockpitModel`, add to the `summary` object after the `ciRed` line (line 261):

```ts
    autoFixStuck: tagged.filter((i) => i.autoFixExhausted).length,
```

- [ ] **Step 4: Add the filter, head, chip class, and signal token**

In `src/dashboard/fleet-render.ts`:

Add to `FILTERS` after `"ci",` (line 154):

```ts
  "auto-fix-failed",
```

In `summaryBar`, add to the `heads` array after the `ciRed` entry (line 168):

```ts
    `${s.autoFixStuck} auto-fix stuck`,
```

In `chips()`, replace the class computation (line 276) so an exhausted item gets the distinct class:

```ts
    const cls = it.autoFixExhausted
      ? "chip critical stuck"
      : it.severity === "critical"
        ? "chip critical"
        : "chip";
```

In `signalsAttr()`, after the loop over `c.items` that adds kind tokens (after line 292), add the exhausted token:

```ts
  if (c.items.some((it) => it.autoFixExhausted)) kinds.add("auto-fix-failed");
```

- [ ] **Step 5: Add the chip style**

In `src/dashboard/fleet-render.ts`, find the dashboard `<style>` block (the document shell template — search for the existing `.chip` rule) and add a `.chip.stuck` rule beside it, e.g.:

```css
.chip.stuck { border: 1px solid #b91c1c; font-weight: 600; }
```

Match the surrounding CSS style (units, color tokens) already used for `.chip.critical`.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run tests/dashboard/fleet-cockpit.test.ts tests/dashboard/fleet-render.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full dashboard suite for regressions**

Run: `pnpm vitest run tests/dashboard`
Expected: PASS — the new head/filter/chip don't disturb existing assertions.

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts src/dashboard/fleet-render.ts tests/dashboard/fleet-cockpit.test.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): auto-fix-failed chip, filter, and summary tally"
```

---

## Task 6: Changeset + full gate

**Files:**
- Create: `.changeset/vuln-auto-fix-exhausted-signal.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/vuln-auto-fix-exhausted-signal.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Surface an "auto-fix failed" signal on the dashboard when Renovate has been
auto-dispatched for the same critical/high vulnerability across 3+ nightly
cycles without clearing it. A per-site `Security Auto-Fix Attempts` counter
(owned by `renovate-dispatch`: incremented on each real dispatch, reset when
the vuln clears) drives a distinct chip, filter, and summary tally so the
operator can tell "Renovate's on it" from "Renovate couldn't fix this — it
needs me". Inert until the Airtable Websites `Security Auto-Fix Attempts`
Number field is added.
```

- [ ] **Step 2: Run the full pre-merge gate**

Run each and confirm green:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist
```

Expected: all PASS. (`test:dist` + `build` catch any public-export or dist-shape regression that unit tests miss.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/vuln-auto-fix-exhausted-signal.md
git commit -m "chore: changeset for the vuln auto-fix-exhausted signal"
```

---

## Rollout note (post-merge, operator step)

The feature is **inert until** the `Security Auto-Fix Attempts` Number field exists on the Airtable Websites table. Either:
- add it by hand (Number, integer) — same one-click setup as the announce/launch fields, or
- create it via the Airtable MCP during/after merge.

Until then: reads coerce to 0 (signal never fires), writes are caught (no-op), `renovate-dispatch` keeps exiting 0. Once added, the counter starts accruing on the next nightly `fleet-security` run; the first "auto-fix failed" chip can appear ~3 nights after a genuinely stuck vuln.

---

## Self-Review

**Spec coverage:** data model (Task 1) · counter lifecycle owned by renovate-dispatch (Tasks 2-3) · skipped≠failed + reset-on-zero + write-minimal (Task 2) · threshold ≥3 + exhausted flavor + forced-critical + flag (Task 4) · signalsAttr token + FILTERS chip + chips class + summary head + autoFixStuck tally (Task 5) · best-effort/ships-dark (Tasks 2-3 + rollout) · changeset minor (Task 6). All spec sections map to a task.

**Type consistency:** `securityAutoFixAttempts` (field), `autoFixExhausted` (item flag), `autoFixStuck` (summary count), `AUTO_FIX_EXHAUSTED_CYCLES` (=3), `computeAutoFixAttemptUpdates` / `applyAutoFixAttemptUpdates` / `formatAutoFixAttemptsSummary`, `updateAutoFixAttempts` — names are used identically across Tasks 1-6.

**No placeholders:** every code/test step shows the actual code; commands have expected outcomes. Two steps (Task 1 mapping test, Task 5 cockpit test, Task 5 style block) explicitly tell the implementer to match an existing file convention rather than guess — that's a real instruction, not a TBD.
