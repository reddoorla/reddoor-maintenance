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
