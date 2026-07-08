import { describe, it, expect } from "vitest";
import { hasFormE2eResult, formE2eResultFromAudit } from "../../src/audits/form-e2e-airtable.js";
import type { AuditResult } from "../../src/types.js";

const fe2e = (details: unknown): AuditResult =>
  ({ audit: "form-e2e", site: "acme", status: "pass", summary: "ok", details }) as AuditResult;

describe("form-e2e-airtable", () => {
  it("hasFormE2eResult is true only for a form-e2e audit carrying a checkedAt", () => {
    expect(
      hasFormE2eResult(
        fe2e({ ok: "pass", formPresent: true, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toBe(true);
    // n/a (no form) still has a checkedAt ⇒ persisted (null verdict clears + timestamps the cell).
    expect(
      hasFormE2eResult(
        fe2e({ ok: null, formPresent: false, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toBe(true);
    expect(hasFormE2eResult(fe2e(undefined))).toBe(false);
  });

  it("formE2eResultFromAudit lifts the verdict (pass/fail/null) + timestamp", () => {
    expect(
      formE2eResultFromAudit(
        fe2e({ ok: "fail", formPresent: true, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toEqual({
      ok: "fail",
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
    expect(
      formE2eResultFromAudit(
        fe2e({ ok: null, formPresent: false, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toEqual({
      ok: null,
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
  });

  it("throws on a non-form-e2e result", () => {
    expect(() =>
      formE2eResultFromAudit({
        audit: "a11y",
        site: "x",
        status: "pass",
        summary: "",
      } as AuditResult),
    ).toThrow(/Expected a 'form-e2e'/);
  });
});
