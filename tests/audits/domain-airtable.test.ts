import { describe, it, expect } from "vitest";
import { hasDomainResult, domainResultFromAudit } from "../../src/audits/domain-airtable.js";
import type { AuditResult } from "../../src/types.js";

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    audit: "domain",
    site: "acme",
    status: "pass",
    summary: "resolved, cert 73d remaining",
    details: { resolved: true, certDaysRemaining: 73, checkedAt: "2026-06-18T00:00:00.000Z" },
    ...over,
  };
}

describe("hasDomainResult", () => {
  it("is true for a domain audit with a details payload", () => {
    expect(hasDomainResult(result())).toBe(true);
  });
  it("is false for a non-domain audit", () => {
    expect(hasDomainResult({ audit: "lighthouse", site: "x", status: "pass", summary: "" })).toBe(
      false,
    );
  });
  it("is false for a skipped domain audit (no details)", () => {
    expect(hasDomainResult(result({ status: "skip", details: undefined }))).toBe(false);
  });
});

describe("domainResultFromAudit", () => {
  it("extracts certDaysRemaining + checkedAt", () => {
    expect(domainResultFromAudit(result())).toEqual({
      certDaysRemaining: 73,
      checkedAt: "2026-06-18T00:00:00.000Z",
    });
  });
  it("maps a null cert (unresolved) to null days", () => {
    const r = result({
      details: { resolved: false, certDaysRemaining: null, checkedAt: "2026-06-18T00:00:00.000Z" },
    });
    expect(domainResultFromAudit(r).certDaysRemaining).toBeNull();
  });
});
