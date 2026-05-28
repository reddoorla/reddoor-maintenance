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
    const bad = { ...secResult({ low: 0, moderate: 0, high: 0, critical: 0 }), audit: "deps" } as AuditResult;
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
    const bad = { ...secResult({ low: 0, moderate: 0, high: 0, critical: 0 }), audit: "deps" } as AuditResult;
    expect(() => securityCountsFromResult(bad)).toThrow(/Expected a 'security'/);
  });
});
