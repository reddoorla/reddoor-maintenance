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
