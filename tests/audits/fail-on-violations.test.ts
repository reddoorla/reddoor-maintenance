import { describe, it, expect } from "vitest";
import { auditExitCode } from "../../src/cli/commands/audit.js";
import type { AuditResult } from "../../src/types.js";

const a11y = (totalViolations: number, status: AuditResult["status"]): AuditResult => ({
  audit: "a11y",
  site: "s",
  status,
  summary: "",
  details: { totalViolations, byImpact: {}, violations: [] },
});

describe("auditExitCode", () => {
  it("is 0 for a clean run without the flag", () => {
    expect(auditExitCode([a11y(0, "pass")], false)).toBe(0);
  });
  it("is 1 when a result status is fail (existing behavior)", () => {
    expect(auditExitCode([a11y(3, "fail")], false)).toBe(1);
  });
  it("stays 0 on a 'warn' a11y result WITHOUT the flag", () => {
    expect(auditExitCode([a11y(2, "warn")], false)).toBe(0);
  });
  it("is 1 on ANY a11y violations WHEN the flag is set (overrides warn)", () => {
    expect(auditExitCode([a11y(2, "warn")], true)).toBe(1);
  });
  it("is 0 with the flag when a11y has zero violations", () => {
    expect(auditExitCode([a11y(0, "pass")], true)).toBe(0);
  });
});
