import { describe, it, expect } from "vitest";
import { hasSmokeResult, smokeResultFromAudit } from "../../src/audits/smoke-airtable.js";
import type { AuditResult } from "../../src/types.js";

const smoke = (details: unknown): AuditResult =>
  ({ audit: "smoke", site: "acme", status: "pass", summary: "ok", details }) as AuditResult;

describe("smoke-airtable", () => {
  it("hasSmokeResult is true only for a smoke audit carrying a checkedAt", () => {
    expect(hasSmokeResult(smoke({ ok: "pass", checkedAt: "2026-07-06T00:00:00.000Z" }))).toBe(true);
    expect(hasSmokeResult(smoke(undefined))).toBe(false);
    expect(
      hasSmokeResult({ audit: "a11y", site: "x", status: "pass", summary: "" } as AuditResult),
    ).toBe(false);
  });

  it("smokeResultFromAudit lifts the verdict + timestamp", () => {
    const r = smokeResultFromAudit(smoke({ ok: "fail", checkedAt: "2026-07-06T00:00:00.000Z" }));
    expect(r).toEqual({ ok: "fail", checkedAt: "2026-07-06T00:00:00.000Z" });
  });

  it("smokeResultFromAudit throws on a non-smoke result", () => {
    expect(() =>
      smokeResultFromAudit({
        audit: "a11y",
        site: "x",
        status: "pass",
        summary: "",
      } as AuditResult),
    ).toThrow(/Expected a 'smoke'/);
  });
});
