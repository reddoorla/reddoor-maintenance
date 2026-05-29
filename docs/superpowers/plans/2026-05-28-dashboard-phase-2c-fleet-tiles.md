# Dashboard Phase 2c — Fleet Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the fleet homepage at `/` so every site card surfaces a11y violations, deps drift, security vulns, last-audited time, and an onboarding (X/4) score — and extend `audit --write-airtable` to persist the new counts.

**Architecture:** Three layers, end-to-end. (1) `audit --write-airtable` learns to write per-audit-type counts to new Airtable columns (lighthouse already wired). (2) `WebsiteRow` + `mapRow` learn the new columns. (3) `renderFleetHomeHtml` rewrites from `<table>` to a per-site card with two visual rows: header (name · url · setup · audited) and metrics (lighthouse scores · a11y · deps · vulns). The render layer reads from `WebsiteRow` only — pure function as today.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, Airtable JS client, Netlify Functions v2 (no change to function layer).

**Spec decisions locked 2026-05-28 (do not re-litigate):**

- Layout: **card per site, two-row** — header line then metrics line.
- Setup score = **4 checks**: first audit done, `Report recipients (To)` set, `maintenence freq` (sic) ≠ "None", `point of contact` set. Onboarded = 4/4.
- Deps signal = **"N drifted (M major)"** where drifted is parity with existing `deps.ts` summary text (any drift ≠ "same", which includes "newer" — same rule as the CLI summary).
- Audited signal = single canonical timestamp from `lastLighthouseAuditAt` (the operator runs all audits together; KISS).
- Metrics only on fleet page; per-site dashboard (`/s/<slug>`) untouched.
- Click-to-trigger audit is **deferred post-1.0** — out of scope here.

**Out of scope:**

- Per-audit-type `last audited at` timestamps. (One signal from lighthouse covers the operator need.)
- Tile changes on `/s/<slug>?t=<token>`.
- Extending `baseline-versions.ts` with release-date metadata for a "days behind" view.
- Any UI affordance for triggering audits from the dashboard.

---

## File Structure

**New files:**

- `src/audits/a11y-airtable.ts` — pure helpers: `hasA11yCounts(result)`, `a11yCountsFromResult(result)` → `{ violations: number }`.
- `src/audits/deps-airtable.ts` — pure helpers: `hasDepsCounts(result)`, `depsCountsFromResult(result)` → `{ drifted: number; majorBehind: number }`.
- `src/audits/security-airtable.ts` — pure helpers: `hasSecurityCounts(result)`, `securityCountsFromResult(result)` → `{ critical: number; high: number; moderate: number; low: number }`.
- `src/audits/write-audits-to-airtable.ts` — orchestrator: takes a `base`, a `WebsiteRow[]`, the audit results, and a `slug`; finds the target row; calls each per-audit updater whose predicate passes; returns a structured summary the CLI prints. Replaces the inline block currently in `runAuditCommand`.
- `src/dashboard/onboarding.ts` — `onboardingStatus(row): { score: number; total: 4; checks: {...} }`. Pure derivation.
- `src/dashboard/relative-time.ts` — `relativeTimeFromNow(iso, now)`: `"2d ago"` / `"3w ago"` / `"—"`. Pure; takes an explicit `now: Date` for testability.
- `tests/audits/a11y-airtable.test.ts`
- `tests/audits/deps-airtable.test.ts`
- `tests/audits/security-airtable.test.ts`
- `tests/audits/write-audits-to-airtable.test.ts`
- `tests/dashboard/onboarding.test.ts`
- `tests/dashboard/relative-time.test.ts`
- `.changeset/dashboard-phase-2c-fleet-tiles.md`

**Modified files:**

- `src/reports/airtable/websites.ts` — extend `WebsiteRow` with 7 new fields; extend `mapRow`; add `updateA11yCounts`, `updateDepsCounts`, `updateSecurityCounts` writer functions next to the existing `updateScores`.
- `src/cli/commands/audit.ts` — replace inline `--write-airtable` block with a call to `writeAuditsToAirtable`.
- `src/dashboard/fleet-render.ts` — rewrite from `<table>` to card layout. Drop the table-specific CSS, add card CSS. Read the new `WebsiteRow` fields; route them through `onboardingStatus` + `relativeTimeFromNow`.
- `src/dashboard/index.ts` — re-export `renderFleetHomeHtml` (no change needed; barrel already exports it; this file is listed so the implementer doesn't accidentally remove the line).
- `tests/dashboard/fleet-render.test.ts` — update tests to the card-layout DOM, add tests for the new metric cells and the empty-state behavior of each.
- `tests/reports/airtable/websites-mapping.test.ts` — add tests for new field mapping.
- `tests/audits/lighthouse-airtable.test.ts` — no change needed (the lighthouse pipeline is unchanged).

**Smoke-gate (`scripts/smoke-dist.mjs`):** no change — `renderFleetHomeHtml` already in `requiredExports`. New per-audit airtable modules are internal to the audit CLI and don't need to be re-exported.

---

## Task 1: Baseline check

**Files:** none

- [ ] **Step 1: Verify worktree is clean and tests pass**

```bash
cd /private/tmp/reddoor-maintenance-phase-2c
git status
pnpm test 2>&1 | tail -20
```

Expected: working tree clean, full vitest run passes (the count when this plan was written was 457 tests passing; the implementer should record the actual baseline and confirm no regressions in later tasks).

If a test fails before any code change, **stop and report** — do not start the work on a red baseline.

---

## Task 2: Extend `WebsiteRow` with new optional metric fields + map them

**Files:**

- Modify: `src/reports/airtable/websites.ts`
- Test: `tests/reports/airtable/websites-mapping.test.ts`

- [ ] **Step 1: Write the failing tests for the new field mappings**

Append to `tests/reports/airtable/websites-mapping.test.ts`:

```typescript
describe("websites/mapRow → new metric fields", () => {
  it("maps A11y Violations", () => {
    expect(row({ "A11y Violations": 3 }).a11yViolations).toBe(3);
    expect(row({}).a11yViolations).toBeNull();
    expect(row({ "A11y Violations": 0 }).a11yViolations).toBe(0);
  });

  it("maps Deps Drifted and Deps Major Behind", () => {
    const r = row({ "Deps Drifted": 5, "Deps Major Behind": 1 });
    expect(r.depsDrifted).toBe(5);
    expect(r.depsMajorBehind).toBe(1);
    expect(row({}).depsDrifted).toBeNull();
    expect(row({}).depsMajorBehind).toBeNull();
  });

  it("maps the four Security Vulns severity counts", () => {
    const r = row({
      "Security Vulns Critical": 1,
      "Security Vulns High": 2,
      "Security Vulns Moderate": 3,
      "Security Vulns Low": 4,
    });
    expect(r.securityVulnsCritical).toBe(1);
    expect(r.securityVulnsHigh).toBe(2);
    expect(r.securityVulnsModerate).toBe(3);
    expect(r.securityVulnsLow).toBe(4);
  });

  it("returns nulls (not zeros) for missing severity counts", () => {
    const r = row({});
    expect(r.securityVulnsCritical).toBeNull();
    expect(r.securityVulnsHigh).toBeNull();
    expect(r.securityVulnsModerate).toBeNull();
    expect(r.securityVulnsLow).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm vitest run tests/reports/airtable/websites-mapping.test.ts`

Expected: FAIL — property does not exist on `WebsiteRow`.

- [ ] **Step 3: Extend `WebsiteRow` and `mapRow`**

In `src/reports/airtable/websites.ts`, add to the `WebsiteRow` type (right above `dashboardToken`):

```typescript
/** Last-known counts from non-lighthouse audits, written by
 *  `audit --write-airtable`. `null` = never audited (or this audit
 *  type was skipped on the last run). 0 = audited, clean. */
a11yViolations: number | null;
depsDrifted: number | null;
depsMajorBehind: number | null;
securityVulnsCritical: number | null;
securityVulnsHigh: number | null;
securityVulnsModerate: number | null;
securityVulnsLow: number | null;
```

In `mapRow`, add (above the `dashboardToken` line):

```typescript
    a11yViolations: (f["A11y Violations"] as number | undefined) ?? null,
    depsDrifted: (f["Deps Drifted"] as number | undefined) ?? null,
    depsMajorBehind: (f["Deps Major Behind"] as number | undefined) ?? null,
    securityVulnsCritical: (f["Security Vulns Critical"] as number | undefined) ?? null,
    securityVulnsHigh: (f["Security Vulns High"] as number | undefined) ?? null,
    securityVulnsModerate: (f["Security Vulns Moderate"] as number | undefined) ?? null,
    securityVulnsLow: (f["Security Vulns Low"] as number | undefined) ?? null,
```

- [ ] **Step 4: Run the mapping tests to verify they pass**

Run: `pnpm vitest run tests/reports/airtable/websites-mapping.test.ts`

Expected: PASS (all of them, including the existing dashboardToken tests).

- [ ] **Step 5: Run the full test suite to verify no regressions**

Run: `pnpm test 2>&1 | tail -10`

Expected: all tests pass. The existing `fleet-render` and `render` tests should still pass because the new fields default to `null` and the existing render code doesn't read them.

If the fleet-render `siteRow()` helper test fixture is missing fields after the type change, TypeScript will complain. Add the new fields with `: null` defaults to the fixture; do **not** change the test assertions yet (that's Task 9).

- [ ] **Step 6: Commit**

```bash
git add src/reports/airtable/websites.ts \
        tests/reports/airtable/websites-mapping.test.ts \
        tests/dashboard/fleet-render.test.ts
git commit -m "feat(airtable): map a11y/deps/security count fields onto WebsiteRow"
```

---

## Task 3: Add the a11y airtable extractor

**Files:**

- Create: `src/audits/a11y-airtable.ts`
- Test: `tests/audits/a11y-airtable.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/audits/a11y-airtable.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hasA11yCounts, a11yCountsFromResult } from "../../src/audits/a11y-airtable.js";
import type { AuditResult } from "../../src/types.js";

function a11yResult(
  details: { totalViolations: number; byImpact: Record<string, number> } | undefined,
  status: AuditResult["status"] = "pass",
): AuditResult {
  return {
    audit: "a11y",
    site: "acme",
    status,
    summary: "ok",
    ...(details ? { details } : {}),
  } as unknown as AuditResult;
}

describe("hasA11yCounts", () => {
  it("returns true when details.totalViolations is a number", () => {
    expect(hasA11yCounts(a11yResult({ totalViolations: 0, byImpact: {} }))).toBe(true);
    expect(hasA11yCounts(a11yResult({ totalViolations: 3, byImpact: { serious: 3 } }))).toBe(true);
  });

  it("returns false when details is missing (audit skipped or infra-failed)", () => {
    expect(hasA11yCounts(a11yResult(undefined))).toBe(false);
  });

  it("returns false when the audit name is not a11y", () => {
    const bad = {
      ...a11yResult({ totalViolations: 0, byImpact: {} }),
      audit: "deps",
    } as AuditResult;
    expect(hasA11yCounts(bad)).toBe(false);
  });
});

describe("a11yCountsFromResult", () => {
  it("returns the total violation count", () => {
    expect(
      a11yCountsFromResult(a11yResult({ totalViolations: 3, byImpact: { serious: 3 } })),
    ).toEqual({
      violations: 3,
    });
  });

  it("returns 0 for a clean audit", () => {
    expect(a11yCountsFromResult(a11yResult({ totalViolations: 0, byImpact: {} }))).toEqual({
      violations: 0,
    });
  });

  it("throws if given a non-a11y AuditResult", () => {
    const bad = {
      ...a11yResult({ totalViolations: 0, byImpact: {} }),
      audit: "deps",
    } as AuditResult;
    expect(() => a11yCountsFromResult(bad)).toThrow(/Expected an 'a11y'/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/audits/a11y-airtable.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/audits/a11y-airtable.ts`:

```typescript
import type { AuditResult } from "../types.js";

type A11yDetails = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
};

/** True when an a11y AuditResult carries real counts worth persisting.
 *  Mirrors the `hasRealScores` policy on lighthouse: write whenever real
 *  data exists, regardless of status (a "warn" or "fail" with concrete
 *  violation counts is exactly what the dashboard needs to track). */
export function hasA11yCounts(result: AuditResult): boolean {
  if (result.audit !== "a11y") return false;
  const details = result.details as A11yDetails | undefined;
  return typeof details?.totalViolations === "number";
}

export function a11yCountsFromResult(result: AuditResult): { violations: number } {
  if (result.audit !== "a11y") {
    throw new Error(`Expected an 'a11y' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as A11yDetails | undefined;
  return { violations: details?.totalViolations ?? 0 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/audits/a11y-airtable.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audits/a11y-airtable.ts tests/audits/a11y-airtable.test.ts
git commit -m "feat(audits): a11y-airtable extractor (predicate + counts)"
```

---

## Task 4: Add the deps airtable extractor

**Files:**

- Create: `src/audits/deps-airtable.ts`
- Test: `tests/audits/deps-airtable.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/audits/deps-airtable.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hasDepsCounts, depsCountsFromResult } from "../../src/audits/deps-airtable.js";
import type { AuditResult } from "../../src/types.js";
import type { DepsDriftEntry } from "../../src/audits/deps.js";

function depsResult(entries: DepsDriftEntry[] | undefined): AuditResult {
  return {
    audit: "deps",
    site: "acme",
    status: "pass",
    summary: "ok",
    ...(entries !== undefined ? { details: entries } : {}),
  } as unknown as AuditResult;
}

const entry = (pkg: string, drift: DepsDriftEntry["drift"]): DepsDriftEntry => ({
  pkg,
  baseline: "1.0.0",
  actual: "1.0.0",
  drift,
});

describe("hasDepsCounts", () => {
  it("returns true when details is an array (even if empty)", () => {
    expect(hasDepsCounts(depsResult([]))).toBe(true);
    expect(hasDepsCounts(depsResult([entry("a", "same")]))).toBe(true);
  });

  it("returns false when details is missing", () => {
    expect(hasDepsCounts(depsResult(undefined))).toBe(false);
  });

  it("returns false when the audit name is not deps", () => {
    const bad = { ...depsResult([]), audit: "a11y" } as AuditResult;
    expect(hasDepsCounts(bad)).toBe(false);
  });
});

describe("depsCountsFromResult", () => {
  it("counts every entry whose drift is not 'same' as drifted", () => {
    // Same semantics as src/audits/deps.ts summary text: "drifted" = drift !== "same".
    // That includes "newer" (ahead of baseline) — kept for parity with the CLI summary.
    const r = depsResult([
      entry("a", "same"),
      entry("b", "patch"),
      entry("c", "minor"),
      entry("d", "major"),
      entry("e", "newer"),
    ]);
    expect(depsCountsFromResult(r)).toEqual({ drifted: 4, majorBehind: 1 });
  });

  it("returns zeros for a clean audit", () => {
    expect(depsCountsFromResult(depsResult([]))).toEqual({ drifted: 0, majorBehind: 0 });
    expect(depsCountsFromResult(depsResult([entry("a", "same")]))).toEqual({
      drifted: 0,
      majorBehind: 0,
    });
  });

  it("throws if given a non-deps AuditResult", () => {
    const bad = { ...depsResult([]), audit: "a11y" } as AuditResult;
    expect(() => depsCountsFromResult(bad)).toThrow(/Expected a 'deps'/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/audits/deps-airtable.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/audits/deps-airtable.ts`:

```typescript
import type { AuditResult } from "../types.js";
import type { DepsDriftEntry } from "./deps.js";

/** True when a deps AuditResult carries a drift-entry array. */
export function hasDepsCounts(result: AuditResult): boolean {
  if (result.audit !== "deps") return false;
  return Array.isArray(result.details);
}

export function depsCountsFromResult(result: AuditResult): {
  drifted: number;
  majorBehind: number;
} {
  if (result.audit !== "deps") {
    throw new Error(`Expected a 'deps' AuditResult, got '${result.audit}'`);
  }
  const entries = (result.details ?? []) as DepsDriftEntry[];
  // Parity with src/audits/deps.ts summary text: "drifted" = drift !== "same",
  // which intentionally includes "newer" (ahead of baseline). Refactor target
  // for a future "actionable drift only" signal; out of scope here.
  const drifted = entries.filter((e) => e.drift !== "same").length;
  const majorBehind = entries.filter((e) => e.drift === "major").length;
  return { drifted, majorBehind };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/audits/deps-airtable.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audits/deps-airtable.ts tests/audits/deps-airtable.test.ts
git commit -m "feat(audits): deps-airtable extractor (drifted + majorBehind)"
```

---

## Task 5: Add the security airtable extractor

**Files:**

- Create: `src/audits/security-airtable.ts`
- Test: `tests/audits/security-airtable.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/audits/security-airtable.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hasSecurityCounts, securityCountsFromResult } from "../../src/audits/security-airtable.js";
import type { AuditResult } from "../../src/types.js";

function secResult(
  counts: { low: number; moderate: number; high: number; critical: number } | undefined,
): AuditResult {
  return {
    audit: "security",
    site: "acme",
    status: "pass",
    summary: "ok",
    ...(counts !== undefined ? { details: { counts, advisories: [] } } : {}),
  } as unknown as AuditResult;
}

describe("hasSecurityCounts", () => {
  it("returns true when details.counts exists", () => {
    expect(hasSecurityCounts(secResult({ low: 0, moderate: 0, high: 0, critical: 0 }))).toBe(true);
    expect(hasSecurityCounts(secResult({ low: 1, moderate: 0, high: 0, critical: 0 }))).toBe(true);
  });

  it("returns false when details is missing (skip case)", () => {
    expect(hasSecurityCounts(secResult(undefined))).toBe(false);
  });

  it("returns false when the audit name is not security", () => {
    const bad = {
      ...secResult({ low: 0, moderate: 0, high: 0, critical: 0 }),
      audit: "deps",
    } as AuditResult;
    expect(hasSecurityCounts(bad)).toBe(false);
  });
});

describe("securityCountsFromResult", () => {
  it("returns the four severity counts", () => {
    expect(
      securityCountsFromResult(secResult({ low: 4, moderate: 3, high: 2, critical: 1 })),
    ).toEqual({ critical: 1, high: 2, moderate: 3, low: 4 });
  });

  it("returns zeros for a clean audit", () => {
    expect(
      securityCountsFromResult(secResult({ low: 0, moderate: 0, high: 0, critical: 0 })),
    ).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
  });

  it("throws if given a non-security AuditResult", () => {
    const bad = {
      ...secResult({ low: 0, moderate: 0, high: 0, critical: 0 }),
      audit: "deps",
    } as AuditResult;
    expect(() => securityCountsFromResult(bad)).toThrow(/Expected a 'security'/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/audits/security-airtable.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/audits/security-airtable.ts`:

```typescript
import type { AuditResult } from "../types.js";

type SecurityDetails = {
  counts: { low: number; moderate: number; high: number; critical: number };
};

/** True when a security AuditResult carries a counts object. Skipped runs
 *  (no pnpm + no npm) have no details and return false. */
export function hasSecurityCounts(result: AuditResult): boolean {
  if (result.audit !== "security") return false;
  const details = result.details as SecurityDetails | undefined;
  return !!details && typeof details.counts === "object";
}

export function securityCountsFromResult(result: AuditResult): {
  critical: number;
  high: number;
  moderate: number;
  low: number;
} {
  if (result.audit !== "security") {
    throw new Error(`Expected a 'security' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as SecurityDetails | undefined;
  const c = details?.counts ?? { low: 0, moderate: 0, high: 0, critical: 0 };
  return { critical: c.critical, high: c.high, moderate: c.moderate, low: c.low };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/audits/security-airtable.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audits/security-airtable.ts tests/audits/security-airtable.test.ts
git commit -m "feat(audits): security-airtable extractor (severity counts)"
```

---

## Task 6: Add Airtable updater functions for the three new audit types

**Files:**

- Modify: `src/reports/airtable/websites.ts`

There is no unit test for these in the existing codebase — the existing `updateScores` is exercised indirectly via the CLI test against a real Airtable; mocking the Airtable client isn't worth the seam here. We get coverage via the orchestrator test in Task 7 which uses a fake `AirtableBase`.

- [ ] **Step 1: Add the three updater functions**

Append to `src/reports/airtable/websites.ts` (below the existing `updateScores`):

```typescript
/** Persist a11y violation count + refreshed-at timestamp. */
export async function updateA11yCounts(
  base: AirtableBase,
  recordId: string,
  counts: { violations: number },
): Promise<void> {
  const fields: FieldSet = {
    "A11y Violations": counts.violations,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Persist deps drift counts. */
export async function updateDepsCounts(
  base: AirtableBase,
  recordId: string,
  counts: { drifted: number; majorBehind: number },
): Promise<void> {
  const fields: FieldSet = {
    "Deps Drifted": counts.drifted,
    "Deps Major Behind": counts.majorBehind,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}

/** Persist security vulnerability counts by severity. */
export async function updateSecurityCounts(
  base: AirtableBase,
  recordId: string,
  counts: { critical: number; high: number; moderate: number; low: number },
): Promise<void> {
  const fields: FieldSet = {
    "Security Vulns Critical": counts.critical,
    "Security Vulns High": counts.high,
    "Security Vulns Moderate": counts.moderate,
    "Security Vulns Low": counts.low,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}
```

- [ ] **Step 2: Run the full test suite to verify no regressions**

Run: `pnpm test 2>&1 | tail -10`

Expected: all tests still pass; the new functions are unreferenced but type-check.

- [ ] **Step 3: Commit**

```bash
git add src/reports/airtable/websites.ts
git commit -m "feat(airtable): updateA11yCounts / updateDepsCounts / updateSecurityCounts"
```

---

## Task 7: Add the audit-airtable orchestrator

**Files:**

- Create: `src/audits/write-audits-to-airtable.ts`
- Test: `tests/audits/write-audits-to-airtable.test.ts`

The orchestrator owns the "for each audit result, if its predicate passes, call its updater" flow. By extracting it from the CLI command we get a unit-testable seam: pass in a fake `AirtableBase` that records calls.

- [ ] **Step 1: Write the failing tests**

Create `tests/audits/write-audits-to-airtable.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { writeAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import type { AuditResult } from "../../src/types.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

type UpdateCall = { table: string; id: string; fields: Record<string, unknown> };

function makeFakeBase(): { base: any; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const base = (table: string) => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const r of recs) calls.push({ table, id: r.id, fields: r.fields });
      return recs;
    },
  });
  return { base, calls };
}

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recACME",
    name: "Acme",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    dashboardToken: "tok",
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    ...over,
  };
}

const lhResult = (summary: Record<string, number>): AuditResult =>
  ({
    audit: "lighthouse",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: { summary },
  }) as unknown as AuditResult;

const a11yResult = (totalViolations: number): AuditResult =>
  ({
    audit: "a11y",
    site: "acme",
    status: totalViolations === 0 ? "pass" : "warn",
    summary: "ok",
    details: { totalViolations, byImpact: {} },
  }) as unknown as AuditResult;

const depsResult = (drifts: Array<"same" | "patch" | "minor" | "major" | "newer">): AuditResult =>
  ({
    audit: "deps",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: drifts.map((drift, i) => ({
      pkg: `pkg${i}`,
      baseline: "1.0.0",
      actual: "1.0.0",
      drift,
    })),
  }) as unknown as AuditResult;

const secResult = (counts: {
  low: number;
  moderate: number;
  high: number;
  critical: number;
}): AuditResult =>
  ({
    audit: "security",
    site: "acme",
    status: counts.critical + counts.high > 0 ? "fail" : "pass",
    summary: "ok",
    details: { counts, advisories: [] },
  }) as unknown as AuditResult;

describe("writeAuditsToAirtable", () => {
  it("writes lighthouse scores when a real-scores lighthouse result is present", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.87, accessibility: 0.95, "best-practices": 0.78, seo: 1 }),
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fields).toMatchObject({
      pScore: 87,
      rScore: 95,
      bpScore: 78,
      seoScore: 100,
    });
    expect(calls[0]?.fields["Last lighthouse audit at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.siteName).toBe("Acme");
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse"]);
  });

  it("writes a11y / deps / security counts alongside lighthouse when all four ran", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        a11yResult(3),
        depsResult(["same", "patch", "minor", "major", "newer"]),
        secResult({ low: 4, moderate: 3, high: 2, critical: 1 }),
      ],
    });
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse", "a11y", "deps", "security"]);
    expect(calls).toHaveLength(4);
    const merged = Object.assign({}, ...calls.map((c) => c.fields));
    expect(merged).toMatchObject({
      pScore: 90,
      "A11y Violations": 3,
      "Deps Drifted": 4,
      "Deps Major Behind": 1,
      "Security Vulns Critical": 1,
      "Security Vulns High": 2,
      "Security Vulns Moderate": 3,
      "Security Vulns Low": 4,
    });
  });

  it("skips audit types whose result is missing or skipped (predicate false)", async () => {
    const { base, calls } = makeFakeBase();
    const summary = await writeAuditsToAirtable({
      base,
      websites: [row()],
      slug: "acme",
      results: [
        lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
        // a11y missing entirely (e.g. --only lighthouse,deps)
        depsResult([]),
        // security skipped (no audit tool)
        {
          audit: "security",
          site: "acme",
          status: "skip",
          summary: "cannot run audit",
        } as unknown as AuditResult,
      ],
    });
    expect(summary.writes.map((w) => w.audit)).toEqual(["lighthouse", "deps"]);
    expect(calls.map((c) => Object.keys(c.fields).join(","))).toEqual([
      "pScore,rScore,bpScore,seoScore,Last lighthouse audit at",
      "Deps Drifted,Deps Major Behind",
    ]);
  });

  it("throws exit-code-1 with hasRealScores message when lighthouse has no scores", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row()],
        slug: "acme",
        results: [
          {
            audit: "lighthouse",
            site: "acme",
            status: "fail",
            summary: "lighthouse: no lhr-*.json written (exit 1)",
          } as unknown as AuditResult,
        ],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Lighthouse audit produced no scores/),
      exitCode: 1,
    });
  });

  it("throws exit-code-2 when lighthouse result is absent (operator passed --only without lighthouse)", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row()],
        slug: "acme",
        results: [a11yResult(0)],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/requires a lighthouse result/),
      exitCode: 2,
    });
  });

  it("throws exit-code-2 when no Websites row matches the slug", async () => {
    const { base } = makeFakeBase();
    await expect(
      writeAuditsToAirtable({
        base,
        websites: [row({ name: "Beta" })], // slugs to "beta", not "acme"
        slug: "acme",
        results: [lhResult({ performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 })],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/No Websites row matched slug "acme"/),
      exitCode: 2,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/audits/write-audits-to-airtable.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the orchestrator**

Create `src/audits/write-audits-to-airtable.ts`:

```typescript
import type { AuditResult } from "../types.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import {
  type WebsiteRow,
  siteSlug,
  updateScores,
  updateA11yCounts,
  updateDepsCounts,
  updateSecurityCounts,
} from "../reports/airtable/websites.js";
import { hasRealScores, lighthouseScoresFromResult } from "./lighthouse-airtable.js";
import { hasA11yCounts, a11yCountsFromResult } from "./a11y-airtable.js";
import { hasDepsCounts, depsCountsFromResult } from "./deps-airtable.js";
import { hasSecurityCounts, securityCountsFromResult } from "./security-airtable.js";

type WriteSummary = {
  siteName: string;
  writes: Array<{ audit: "lighthouse" | "a11y" | "deps" | "security"; counts: object }>;
};

/** Orchestrates the per-audit Airtable writes for `audit --write-airtable`.
 *  Extracted from the CLI command so it can be unit-tested with a fake base
 *  and so adding new audit types is a one-line addition here rather than
 *  growing the CLI handler.
 *
 *  Throws (with .exitCode set) on the failure modes the CLI surfaces today:
 *   - 2: --only ran without lighthouse, or no Websites row matched the slug
 *   - 1: lighthouse ran but produced no real scores (infrastructure failure) */
export async function writeAuditsToAirtable(args: {
  base: AirtableBase;
  websites: WebsiteRow[];
  slug: string;
  results: AuditResult[];
}): Promise<WriteSummary> {
  const { base, websites, slug, results } = args;

  const lhResult = results.find((r) => r.audit === "lighthouse");
  if (!lhResult) {
    throw Object.assign(
      new Error(
        "--write-airtable requires a lighthouse result; did you pass --only without lighthouse?",
      ),
      { exitCode: 2 },
    );
  }
  if (!hasRealScores(lhResult)) {
    throw Object.assign(
      new Error(
        `Lighthouse audit produced no scores; refusing to write to Airtable. Summary: ${lhResult.summary}`,
      ),
      { exitCode: 1 },
    );
  }

  const target = websites.find((w) => siteSlug(w.name) === slug);
  if (!target) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }

  const writes: WriteSummary["writes"] = [];

  const scores = lighthouseScoresFromResult(lhResult);
  await updateScores(base, target.id, scores);
  writes.push({ audit: "lighthouse", counts: scores });

  const a11y = results.find((r) => r.audit === "a11y");
  if (a11y && hasA11yCounts(a11y)) {
    const counts = a11yCountsFromResult(a11y);
    await updateA11yCounts(base, target.id, counts);
    writes.push({ audit: "a11y", counts });
  }

  const deps = results.find((r) => r.audit === "deps");
  if (deps && hasDepsCounts(deps)) {
    const counts = depsCountsFromResult(deps);
    await updateDepsCounts(base, target.id, counts);
    writes.push({ audit: "deps", counts });
  }

  const sec = results.find((r) => r.audit === "security");
  if (sec && hasSecurityCounts(sec)) {
    const counts = securityCountsFromResult(sec);
    await updateSecurityCounts(base, target.id, counts);
    writes.push({ audit: "security", counts });
  }

  return { siteName: target.name, writes };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/audits/write-audits-to-airtable.test.ts`

Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audits/write-audits-to-airtable.ts tests/audits/write-audits-to-airtable.test.ts
git commit -m "feat(audits): writeAuditsToAirtable orchestrator (testable seam)"
```

---

## Task 8: Wire orchestrator into `audit --write-airtable`

**Files:**

- Modify: `src/cli/commands/audit.ts`

- [ ] **Step 1: Replace the inline write block with a call to the orchestrator**

In `src/cli/commands/audit.ts`, find the block that starts with `if (opts.writeAirtable !== undefined) {` and replace it (lines 67–110 in the current source) with:

```typescript
if (opts.writeAirtable !== undefined) {
  const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
  const { listWebsites } = await import("../../reports/airtable/websites.js");
  const { resolveSlugFromCwd } = await import("../../audits/lighthouse-airtable.js");
  const { writeAuditsToAirtable } = await import("../../audits/write-audits-to-airtable.js");

  const slug =
    typeof opts.writeAirtable === "string" && opts.writeAirtable.length > 0
      ? opts.writeAirtable
      : await resolveSlugFromCwd(cwd);

  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const summary = await writeAuditsToAirtable({ base, websites, slug, results });

  const lines = summary.writes.map((w) => {
    if (w.audit === "lighthouse") {
      const s = w.counts as {
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
      };
      return `  lighthouse: P=${s.performance} A=${s.accessibility} BP=${s.bestPractices} SEO=${s.seo}`;
    }
    if (w.audit === "a11y") {
      return `  a11y: ${(w.counts as { violations: number }).violations} violations`;
    }
    if (w.audit === "deps") {
      const c = w.counts as { drifted: number; majorBehind: number };
      return `  deps: ${c.drifted} drifted (${c.majorBehind} major)`;
    }
    const c = w.counts as { critical: number; high: number; moderate: number; low: number };
    return `  security: ${c.critical}C/${c.high}H/${c.moderate}M/${c.low}L`;
  });
  output += `\n\n→ wrote to Websites[${summary.siteName}]:\n${lines.join("\n")}`;
}
```

The `lighthouseScoresFromResult` / `hasRealScores` imports that used to live in this file are removed — they are now used inside the orchestrator. The `resolveSlugFromCwd` import stays (used here to derive the slug before calling the orchestrator).

- [ ] **Step 2: Run the existing CLI test to verify no regression**

The existing `tests/cli/audit-command.test.ts` runs the built CLI against fixtures and doesn't exercise `--write-airtable` (which requires real Airtable). It should still pass unchanged.

Run: `pnpm build && pnpm vitest run tests/cli/audit-command.test.ts`

Expected: build OK, all 4 tests pass.

- [ ] **Step 3: Run the full test suite to confirm**

Run: `pnpm test 2>&1 | tail -10`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/audit.ts
git commit -m "refactor(audit): wire writeAuditsToAirtable orchestrator into --write-airtable"
```

---

## Task 9: Add `onboardingStatus` derivation

**Files:**

- Create: `src/dashboard/onboarding.ts`
- Test: `tests/dashboard/onboarding.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard/onboarding.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { onboardingStatus } from "../../src/dashboard/onboarding.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recX",
    name: "Acme",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "None",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    dashboardToken: "tok",
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    ...over,
  };
}

describe("onboardingStatus", () => {
  it("returns 0/4 when nothing is set", () => {
    const s = onboardingStatus(row());
    expect(s.score).toBe(0);
    expect(s.total).toBe(4);
    expect(s.checks).toEqual({
      firstAudit: false,
      recipients: false,
      schedule: false,
      poc: false,
    });
  });

  it("returns 4/4 when all four checks pass", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
        maintenanceFreq: "Monthly",
        pointOfContact: "Tucker",
      }),
    );
    expect(s.score).toBe(4);
    expect(s.checks).toEqual({
      firstAudit: true,
      recipients: true,
      schedule: true,
      poc: true,
    });
  });

  it("treats maintenanceFreq 'None' as schedule-not-set", () => {
    expect(onboardingStatus(row({ maintenanceFreq: "None" })).checks.schedule).toBe(false);
    expect(onboardingStatus(row({ maintenanceFreq: "Monthly" })).checks.schedule).toBe(true);
    expect(onboardingStatus(row({ maintenanceFreq: "Quarterly" })).checks.schedule).toBe(true);
    expect(onboardingStatus(row({ maintenanceFreq: "Yearly" })).checks.schedule).toBe(true);
  });

  it("treats empty-string fields as not-set", () => {
    expect(onboardingStatus(row({ reportRecipientsTo: "" })).checks.recipients).toBe(false);
    expect(onboardingStatus(row({ pointOfContact: "  " })).checks.poc).toBe(false);
  });

  it("counts partial onboarding correctly", () => {
    const s = onboardingStatus(
      row({
        lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
        reportRecipientsTo: "tucker@reddoorla.com",
      }),
    );
    expect(s.score).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/dashboard/onboarding.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/dashboard/onboarding.ts`:

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";

export type OnboardingStatus = {
  score: number;
  total: 4;
  checks: {
    firstAudit: boolean;
    recipients: boolean;
    schedule: boolean;
    poc: boolean;
  };
};

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/** Four-point onboarding signal for the fleet card. A site is "fully onboarded"
 *  when it has been audited at least once, has a To-recipient for monthly
 *  reports, has a maintenance schedule that isn't "None", and has a named POC. */
export function onboardingStatus(row: WebsiteRow): OnboardingStatus {
  const checks = {
    firstAudit: isNonEmpty(row.lastLighthouseAuditAt),
    recipients: isNonEmpty(row.reportRecipientsTo),
    schedule: row.maintenanceFreq !== "None",
    poc: isNonEmpty(row.pointOfContact),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { score, total: 4, checks };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/dashboard/onboarding.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/onboarding.ts tests/dashboard/onboarding.test.ts
git commit -m "feat(dashboard): onboardingStatus 4-point derivation"
```

---

## Task 10: Add `relativeTimeFromNow` helper

**Files:**

- Create: `src/dashboard/relative-time.ts`
- Test: `tests/dashboard/relative-time.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/dashboard/relative-time.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { relativeTimeFromNow } from "../../src/dashboard/relative-time.js";

const NOW = new Date("2026-05-28T12:00:00Z");

describe("relativeTimeFromNow", () => {
  it("returns '—' for null", () => {
    expect(relativeTimeFromNow(null, NOW)).toBe("—");
  });

  it("returns 'just now' for under 1 minute", () => {
    expect(relativeTimeFromNow("2026-05-28T11:59:30Z", NOW)).toBe("just now");
  });

  it("returns 'Nm ago' for under 1 hour", () => {
    expect(relativeTimeFromNow("2026-05-28T11:55:00Z", NOW)).toBe("5m ago");
    expect(relativeTimeFromNow("2026-05-28T11:01:00Z", NOW)).toBe("59m ago");
  });

  it("returns 'Nh ago' for under 1 day", () => {
    expect(relativeTimeFromNow("2026-05-28T10:00:00Z", NOW)).toBe("2h ago");
    expect(relativeTimeFromNow("2026-05-27T13:00:00Z", NOW)).toBe("23h ago");
  });

  it("returns 'Nd ago' for under 1 week", () => {
    expect(relativeTimeFromNow("2026-05-26T12:00:00Z", NOW)).toBe("2d ago");
    expect(relativeTimeFromNow("2026-05-22T12:00:00Z", NOW)).toBe("6d ago");
  });

  it("returns 'Nw ago' for under 1 month", () => {
    expect(relativeTimeFromNow("2026-05-21T12:00:00Z", NOW)).toBe("1w ago");
    expect(relativeTimeFromNow("2026-05-01T12:00:00Z", NOW)).toBe("3w ago");
  });

  it("returns 'Nmo ago' beyond 4 weeks", () => {
    expect(relativeTimeFromNow("2026-03-28T12:00:00Z", NOW)).toBe("2mo ago");
    expect(relativeTimeFromNow("2025-05-28T12:00:00Z", NOW)).toBe("12mo ago");
  });

  it("returns '—' for invalid ISO strings", () => {
    expect(relativeTimeFromNow("not-a-date", NOW)).toBe("—");
    expect(relativeTimeFromNow("", NOW)).toBe("—");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/dashboard/relative-time.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/dashboard/relative-time.ts`:

```typescript
/** Render an absolute timestamp as a coarse "Xd ago" relative string for the
 *  fleet card. Takes an explicit `now` for testability; defaults to wall clock
 *  for callers (the Netlify function). Returns "—" for null / unparseable. */
export function relativeTimeFromNow(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";

  const seconds = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/dashboard/relative-time.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/relative-time.ts tests/dashboard/relative-time.test.ts
git commit -m "feat(dashboard): relativeTimeFromNow helper"
```

---

## Task 11: Rewrite `renderFleetHomeHtml` to card layout

**Files:**

- Modify: `src/dashboard/fleet-render.ts`
- Modify: `tests/dashboard/fleet-render.test.ts`

The render module currently emits a `<table>`. After this task it emits one `<article class="card">` per site, each containing two rows: a header row (name + url + setup + audited) and a metrics row (lighthouse + a11y + deps + security).

- [ ] **Step 1: Replace `tests/dashboard/fleet-render.test.ts` to reflect the card layout**

This is a full rewrite of the test file (the existing table-based assertions are no longer correct). Write `tests/dashboard/fleet-render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderFleetHomeHtml } from "../../src/dashboard/fleet-render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    ga4PropertyId: null,
    reportRecipientsTo: "tucker@reddoorla.com",
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    dashboardToken: "tok",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  };
}

describe("renderFleetHomeHtml — document shell", () => {
  it("returns a full HTML document", () => {
    const html = renderFleetHomeHtml([siteRow()]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
  });

  it("includes a sensible page title", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/<title>[^<]*Reddoor[^<]*<\/title>/);
  });

  it("renders the empty state when no sites are passed", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/no sites/i);
  });
});

describe("renderFleetHomeHtml — card per site", () => {
  it('emits one <article class="card"> per site', () => {
    const html = renderFleetHomeHtml([
      siteRow({ id: "rec1", name: "Acme Co" }),
      siteRow({ id: "rec2", name: "Beta Inc" }),
      siteRow({ id: "rec3", name: "Gamma LLC" }),
    ]);
    const cards = html.match(/<article class="card"/g) ?? [];
    expect(cards).toHaveLength(3);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links the site name to /s/<slug>?t=<token>", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "CalTex", dashboardToken: "abc123" })]);
    expect(html).toContain('href="/s/caltex?t=abc123"');
  });
});

describe("renderFleetHomeHtml — header row (setup + audited)", () => {
  it("shows '4/4' when the site is fully onboarded", () => {
    const html = renderFleetHomeHtml([siteRow()]);
    expect(html).toContain(">4/4<");
  });

  it("shows the partial fraction when the site is missing some onboarding signals", () => {
    const html = renderFleetHomeHtml([siteRow({ pointOfContact: null, reportRecipientsTo: null })]);
    expect(html).toContain(">2/4<");
  });

  it("renders the lighthouse-audited timestamp as a relative-time string", () => {
    // 2026-05-27T18:00:00Z viewed at 2026-05-28T18:00:00Z = 24h = '1d ago'.
    // We can't pin "now" in the render layer, so just assert SOMETHING
    // relative-time-shaped renders for a non-null timestamp and that "—"
    // renders for a null timestamp.
    const audited = renderFleetHomeHtml([siteRow()]);
    expect(audited).toMatch(/(just now|\d+[mhdw]o? ago)/);

    const never = renderFleetHomeHtml([siteRow({ lastLighthouseAuditAt: null })]);
    expect(never).toMatch(/Audited[^<]*<[^>]*>\s*—\s*</);
  });
});

describe("renderFleetHomeHtml — metrics row", () => {
  it("renders the four lighthouse scores", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 }),
    ]);
    // The implementer must label the 4 numbers in DOM (e.g. spans with
    // class="score perf" etc.) so this test can target precisely. Until
    // then, the looser content assertion below is the contract.
    expect(html).toContain(">73<");
    expect(html).toContain(">78<");
  });

  it("renders an em-dash placeholder for null lighthouse scores", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
    ]);
    expect(html).not.toContain(">null<");
    expect(html).toMatch(/<span class="score perf">—<\/span>/);
  });

  it("renders the a11y violation count", () => {
    const html = renderFleetHomeHtml([siteRow({ a11yViolations: 3 })]);
    expect(html).toMatch(/<span class="metric a11y">3<\/span>/);
  });

  it("renders '—' for a never-audited a11y count", () => {
    const html = renderFleetHomeHtml([siteRow({ a11yViolations: null })]);
    expect(html).toMatch(/<span class="metric a11y">—<\/span>/);
  });

  it("renders deps as 'N drifted (M major)' when there is drift", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: 5, depsMajorBehind: 1 })]);
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
  });

  it("renders deps as '0' when clean", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: 0, depsMajorBehind: 0 })]);
    expect(html).toMatch(/<span class="metric deps">0<\/span>/);
  });

  it("renders deps as '—' when never audited", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: null, depsMajorBehind: null })]);
    expect(html).toMatch(/<span class="metric deps">—<\/span>/);
  });

  it("renders security as 'C/H/M/L' format when there are vulns", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: 1,
        securityVulnsHigh: 2,
        securityVulnsModerate: 3,
        securityVulnsLow: 4,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">1C\/2H\/3M\/4L<\/span>/);
  });

  it("renders security as '0' when clean", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityVulnsModerate: 0,
        securityVulnsLow: 0,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">0<\/span>/);
  });

  it("renders security as '—' when never audited", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: null,
        securityVulnsHigh: null,
        securityVulnsModerate: null,
        securityVulnsLow: null,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">—<\/span>/);
  });
});

describe("renderFleetHomeHtml — escaping & safety", () => {
  it("escapes HTML in site names and URLs", () => {
    const html = renderFleetHomeHtml([
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
    ]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("escapes the dashboard token in the href", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "Acme", dashboardToken: 'a"b&c' })]);
    expect(html).not.toMatch(/href="[^"]*"[^"]*b&c/);
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`

Expected: many failures (the existing implementation emits `<table>`, not `<article>`, and has no a11y/deps/security cells).

- [ ] **Step 3: Replace `src/dashboard/fleet-render.ts` with the card layout**

Overwrite `src/dashboard/fleet-render.ts`:

```typescript
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import { onboardingStatus } from "./onboarding.js";
import { relativeTimeFromNow } from "./relative-time.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}

const DASH = "—";

function scoreSpan(category: "perf" | "a11y-lh" | "bp" | "seo", value: number | null): string {
  const display = value === null ? DASH : String(value);
  return `<span class="score ${category}">${escapeHtml(display)}</span>`;
}

function a11ySpan(value: number | null): string {
  const display = value === null ? DASH : String(value);
  return `<span class="metric a11y">${escapeHtml(display)}</span>`;
}

function depsSpan(drifted: number | null, majorBehind: number | null): string {
  if (drifted === null || majorBehind === null) {
    return `<span class="metric deps">${DASH}</span>`;
  }
  const display = drifted === 0 ? "0" : `${drifted} drifted (${majorBehind} major)`;
  return `<span class="metric deps">${escapeHtml(display)}</span>`;
}

function securitySpan(
  critical: number | null,
  high: number | null,
  moderate: number | null,
  low: number | null,
): string {
  if (critical === null || high === null || moderate === null || low === null) {
    return `<span class="metric sec">${DASH}</span>`;
  }
  const total = critical + high + moderate + low;
  const display = total === 0 ? "0" : `${critical}C/${high}H/${moderate}M/${low}L`;
  return `<span class="metric sec">${escapeHtml(display)}</span>`;
}

function card(site: WebsiteRow): string {
  const name = escapeHtml(site.name);
  // Caller is responsible for filtering — render assumes every site has a
  // dashboardToken. The `?? ""` is a defensive nudge if a misuse ever slips through.
  const token = site.dashboardToken ?? "";
  const href = `/s/${escapeHtml(siteSlug(site.name))}?t=${escapeHtml(token)}`;
  const onboarding = onboardingStatus(site);
  const audited = relativeTimeFromNow(site.lastLighthouseAuditAt);
  const safeSiteUrl = escapeHtml(safeUrl(site.url));
  const visibleUrl = escapeHtml(site.url);

  return `<article class="card">
    <header class="card-head">
      <a class="site" href="${href}">${name}</a>
      <a class="url" href="${safeSiteUrl}" target="_blank" rel="noopener">${visibleUrl}</a>
      <span class="setup">Setup: <strong>${onboarding.score}/${onboarding.total}</strong></span>
      <span class="audited">Audited: <strong>${escapeHtml(audited)}</strong></span>
    </header>
    <div class="card-metrics">
      <span class="cluster lighthouse">
        ${scoreSpan("perf", site.pScore)}
        ${scoreSpan("a11y-lh", site.rScore)}
        ${scoreSpan("bp", site.bpScore)}
        ${scoreSpan("seo", site.seoScore)}
      </span>
      <span class="cluster health">
        <span class="metric-label">a11y</span> ${a11ySpan(site.a11yViolations)}
        <span class="metric-label">deps</span> ${depsSpan(site.depsDrifted, site.depsMajorBehind)}
        <span class="metric-label">sec</span> ${securitySpan(
          site.securityVulnsCritical,
          site.securityVulnsHigh,
          site.securityVulnsModerate,
          site.securityVulnsLow,
        )}
      </span>
    </div>
  </article>`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 1.5rem; }
.empty { color: #999; padding: 2rem; text-align: center; border: 1px dashed #ccc; border-radius: 6px; }
.cards { display: flex; flex-direction: column; gap: 0.75rem; }
.card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 0.9rem 1.1rem; }
@media (prefers-color-scheme: dark) { .card { border-color: #2a2a2a; background: #181818; } }
.card-head { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; align-items: baseline; }
.card-head .site { font-weight: 600; font-size: 1.05rem; }
.card-head .url { color: #666; font-size: 0.85rem; }
.card-head .setup, .card-head .audited { margin-left: auto; color: #666; font-size: 0.85rem; }
.card-head .setup { margin-left: auto; }
.card-head .audited { margin-left: 0; }
.card-metrics { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; margin-top: 0.5rem; font-variant-numeric: tabular-nums; }
.cluster { display: inline-flex; gap: 0.5rem; align-items: baseline; }
.cluster.lighthouse .score { display: inline-block; min-width: 2.25rem; text-align: right; }
.metric-label { color: #999; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.metric { font-feature-settings: "tnum"; }
`;

/**
 * Render the fleet homepage as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * filters Websites rows (drops anything without a dashboardToken), sorts,
 * and hands here. One <article class="card"> per site, with a header row
 * (name · url · setup · audited) and a metrics row (lighthouse · a11y · deps · sec).
 */
export function renderFleetHomeHtml(sites: WebsiteRow[]): string {
  const body =
    sites.length === 0
      ? `<div class="empty">No sites to display.</div>`
      : `<div class="cards">${sites.map(card).join("")}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddoor maintenance — fleet</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet</h1>
  <div class="meta">${sites.length} site${sites.length === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${body}
</body>
</html>`;
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`

Expected: PASS (all of them).

- [ ] **Step 5: Run the full test suite to confirm**

Run: `pnpm test 2>&1 | tail -10`

Expected: all tests pass.

- [ ] **Step 6: Build and smoke-test against dist**

```bash
pnpm build && node scripts/smoke-dist.mjs
```

Expected: all smoke checks pass, including `renderFleetHomeHtml` in the exports check.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): card layout with a11y/deps/sec metrics + setup/audited row"
```

---

## Task 12: Add the changeset

**Files:**

- Create: `.changeset/dashboard-phase-2c-fleet-tiles.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/dashboard-phase-2c-fleet-tiles.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Fleet homepage now shows per-site cards with a11y violations, deps drift (count + major-behind), security vulnerability counts by severity, last-audited relative time, and a 4-point onboarding status. `audit --write-airtable` extended to persist the new counts to seven new `Websites` columns (`A11y Violations`, `Deps Drifted`, `Deps Major Behind`, `Security Vulns Critical/High/Moderate/Low`) alongside the existing Lighthouse fields.

**Operator action required:** add the seven new number columns to the Airtable Websites table before running `audit --write-airtable` on the new version. Missing columns won't crash — they'll just stay `null` on the dashboard until populated.
```

- [ ] **Step 2: Run formatter check**

Run: `pnpm lint`

Expected: clean (prettier check passes for the new file).

- [ ] **Step 3: Commit**

```bash
git add .changeset/dashboard-phase-2c-fleet-tiles.md
git commit -m "chore: changeset for dashboard Phase 2c"
```

---

## Task 13: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test 2>&1 | tail -15`

Expected: all tests pass; count is baseline + (websites-mapping additions + a11y-airtable + deps-airtable + security-airtable + write-audits-to-airtable + onboarding + relative-time + fleet-render rewrite).

- [ ] **Step 2: Run the lint check**

Run: `pnpm lint`

Expected: clean.

- [ ] **Step 3: Run the dist smoke gate**

```bash
pnpm build && node scripts/smoke-dist.mjs
```

Expected: all smoke checks pass.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/dashboard-phase-2c-fleet-tiles
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(dashboard): Phase 2c — a11y/deps/sec tiles + onboarding status on fleet cards" --body "$(cat <<'EOF'
## Summary
- Fleet homepage rewrites to a per-site card layout (header: name · url · setup · audited; metrics: lighthouse · a11y · deps · sec).
- `audit --write-airtable` extends to persist a11y violations, deps drift counts, and security vulnerability counts by severity.
- New `WebsiteRow` fields and Airtable column mappings; orchestrator extracted from the CLI for testability.
- Onboarding score (X/4) derived from: first audit done, Report recipients (To) set, maintenance freq ≠ None, point of contact named.

## Operator action required
Add seven number columns to the `Websites` Airtable table before the next `audit --write-airtable`:
- `A11y Violations`
- `Deps Drifted`
- `Deps Major Behind`
- `Security Vulns Critical`
- `Security Vulns High`
- `Security Vulns Moderate`
- `Security Vulns Low`

Missing columns won't crash — they'll just stay `null` on the dashboard until populated.

## Test plan
- [x] `pnpm test` — full vitest pass
- [x] `pnpm lint` — prettier clean
- [x] `pnpm build && node scripts/smoke-dist.mjs` — dist smoke gate passes
- [ ] Manual: after add of the 7 Airtable columns + first `audit --write-airtable` run, the CalTex card on `/` shows non-null tiles.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Locked decision                                                   | Task                                   |
| ----------------------------------------------------------------- | -------------------------------------- |
| Card per site, two-row layout                                     | Task 11                                |
| Setup = 4 checks (first audit / recipients / schedule / poc)      | Task 9 (derivation), Task 11 (render)  |
| Deps = "N drifted (M major)" with parity to existing summary      | Task 4 (extract), Task 11 (render)     |
| Audited = single canonical timestamp from `lastLighthouseAuditAt` | Task 10 (helper), Task 11 (render)     |
| Metrics only on fleet page; `/s/<slug>` untouched                 | No `render.ts` modifications anywhere  |
| a11y violations (count)                                           | Tasks 3, 6, 7, 11                      |
| Outdated deps (count + major-version count)                       | Tasks 4, 6, 7, 11                      |
| Security vulns (count, by severity)                               | Tasks 5, 6, 7, 11                      |
| Click-to-trigger audit                                            | OUT OF SCOPE (post-1.0)                |
| Operator must create new Airtable columns                         | Task 12 (changeset), Task 13 (PR body) |

**Placeholder scan:** no `TBD` / `implement later` / "handle edge cases" / "similar to Task N" anywhere. Each step shows the actual code.

**Type consistency:**

- `WebsiteRow` field names: `a11yViolations`, `depsDrifted`, `depsMajorBehind`, `securityVulnsCritical`, `securityVulnsHigh`, `securityVulnsModerate`, `securityVulnsLow` — consistent across Tasks 2, 7, 9, 11, and all test fixtures.
- Airtable field names: `"A11y Violations"`, `"Deps Drifted"`, `"Deps Major Behind"`, `"Security Vulns Critical/High/Moderate/Low"` — consistent across Tasks 2 (mapRow), 6 (updaters), and 7 (orchestrator test).
- Predicate / extractor pair names: `hasA11yCounts` / `a11yCountsFromResult`, `hasDepsCounts` / `depsCountsFromResult`, `hasSecurityCounts` / `securityCountsFromResult`. Consistent with the existing `hasRealScores` / `lighthouseScoresFromResult` pair.
- Updater names: `updateA11yCounts` / `updateDepsCounts` / `updateSecurityCounts`. Consistent with the existing `updateScores`.
- Orchestrator: `writeAuditsToAirtable` (Task 7) is the same identifier in the CLI wire-up (Task 8).
- Setup-check property names: `firstAudit`, `recipients`, `schedule`, `poc`. Consistent across Task 9 tests and implementation.

**Coverage of failure modes preserved from existing CLI:**

- exit 2 when `--only` ran without lighthouse → Task 7 test + impl.
- exit 1 when lighthouse produced no real scores → Task 7 test + impl.
- exit 2 when no Websites row matched slug → Task 7 test + impl.

**Risks / known gaps the implementer should flag if they hit them:**

- The CSS for `.card-head` uses `margin-left: auto` on `.setup` then `0` on `.audited` — that's intentional (push setup to the right, audited follows it). If flex wraps awkwardly on narrow viewports, leave the rough version and note it; visual polish isn't blocking.
- The `siteRow()` test fixture in Task 11 now requires 7 new fields to type-check. If Task 2 doesn't update the test fixture, Task 11 will hit a TS error in Step 1. Task 2 Step 5 explicitly addresses this.
- `pnpm lint` (Task 13 Step 2) may auto-fix the new files' formatting. If it does, run it again until clean, then commit any formatter changes as their own commit (`chore: prettier`).
