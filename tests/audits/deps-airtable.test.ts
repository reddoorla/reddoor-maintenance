import { describe, it, expect } from "vitest";
import { hasDepsCounts, depsCountsFromResult } from "../../src/audits/deps-airtable.js";
import type { AuditResult } from "../../src/types.js";
import type { DepsDriftEntry } from "../../src/audits/deps.js";
import type { OutdatedCounts } from "../../src/audits/deps-outdated.js";

function depsResult(
  entries: DepsDriftEntry[] | undefined,
  outdated: OutdatedCounts | null = null,
): AuditResult {
  return {
    audit: "deps",
    site: "acme",
    status: "pass",
    summary: "ok",
    ...(entries !== undefined ? { details: { entries, outdated } } : {}),
  } as unknown as AuditResult;
}

const entry = (pkg: string, drift: DepsDriftEntry["drift"]): DepsDriftEntry => ({
  pkg,
  baseline: "1.0.0",
  actual: "1.0.0",
  drift,
});

describe("hasDepsCounts", () => {
  it("returns true when details carries an entries array (even if empty)", () => {
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
  it("counts every entry whose drift is not 'same' as drifted, and surfaces the outdated count", () => {
    // "drifted" = drift !== "same" (incl. "newer", for parity with the CLI summary).
    const r = depsResult(
      [
        entry("a", "same"),
        entry("b", "patch"),
        entry("c", "minor"),
        entry("d", "major"),
        entry("e", "newer"),
      ],
      { outdated: 7, major: 2 },
    );
    expect(depsCountsFromResult(r)).toEqual({
      drifted: 4,
      majorBehind: 1,
      outdated: 7,
      majorOutdated: 2,
    });
  });

  it("surfaces the registry-major count (how many are a major behind npm latest)", () => {
    // outdated total and major are computed together by the deps-outdated scan;
    // the mapping must carry BOTH through, not just the total.
    expect(
      depsCountsFromResult(depsResult([entry("a", "minor")], { outdated: 3, major: 0 })),
    ).toEqual({ drifted: 1, majorBehind: 0, outdated: 3, majorOutdated: 0 });
  });

  it("reports outdated and majorOutdated as null when the outdated signal wasn't determined", () => {
    expect(depsCountsFromResult(depsResult([entry("a", "minor")], null))).toEqual({
      drifted: 1,
      majorBehind: 0,
      outdated: null,
      majorOutdated: null,
    });
  });

  it("returns zeros (and null outdated/majorOutdated) for a clean audit", () => {
    expect(depsCountsFromResult(depsResult([]))).toEqual({
      drifted: 0,
      majorBehind: 0,
      outdated: null,
      majorOutdated: null,
    });
  });

  it("throws if given a non-deps AuditResult", () => {
    const bad = { ...depsResult([]), audit: "a11y" } as AuditResult;
    expect(() => depsCountsFromResult(bad)).toThrow(/Expected a 'deps'/);
  });
});
