import { describe, it, expect } from "vitest";
import {
  hasFunctionHealthResult,
  functionHealthResultFromAudit,
} from "../../src/audits/function-health-airtable.js";
import type { AuditResult } from "../../src/types.js";

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    audit: "function-health",
    site: "acme",
    status: "pass",
    summary: "health ok (prismic ok)",
    details: { ok: true, prismic: "ok", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    ...over,
  };
}

describe("hasFunctionHealthResult", () => {
  it("is true for a function-health audit with a details payload", () => {
    expect(hasFunctionHealthResult(result())).toBe(true);
  });
  it("is false for a non-function-health audit", () => {
    expect(
      hasFunctionHealthResult({ audit: "domain", site: "x", status: "pass", summary: "" }),
    ).toBe(false);
  });
  it("is false for a self-skipped audit (no details → writer preserves prior)", () => {
    expect(hasFunctionHealthResult(result({ status: "skip", details: undefined }))).toBe(false);
  });
});

describe("functionHealthResultFromAudit", () => {
  it("maps ok:true + prismic ok → pass / pass", () => {
    expect(functionHealthResultFromAudit(result())).toEqual({
      functionHealth: "pass",
      cmsReachable: "pass",
      turnstileWidget: null,
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
  });
  it("maps ok:false → functionHealth fail", () => {
    const r = result({
      details: { ok: false, prismic: "ok", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(r).functionHealth).toBe("fail");
  });
  // R2.2: prismic "error" is a real CMS failure → cmsReachable fail.
  it("maps prismic error → cmsReachable fail", () => {
    const err = result({
      details: { ok: true, prismic: "error", forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(err).cmsReachable).toBe("fail");
  });
  // R2.2 (supersedes the plan's "error/skipped/null → fail" text): "skipped" is a placeholder repo
  // that never ran the CMS probe at all — must NOT red CMS, so it's null (never-ran), not fail.
  it("maps prismic skipped → cmsReachable null (never-ran, not fail — R2.2)", () => {
    const skip = result({
      details: {
        ok: true,
        prismic: "skipped",
        forms: null,
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(skip).cmsReachable).toBeNull();
  });
  // A raw null prismic (the synthetic "deployed but erroring" body, or an unrecognized value) means
  // the CMS probe never produced a real reading either — same "never-ran" null, not fail.
  it("maps prismic null → cmsReachable null (never-ran, not fail — R2.2)", () => {
    const nullPrismic = result({
      details: { ok: false, prismic: null, forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(nullPrismic).cmsReachable).toBeNull();
  });
  it("maps forms.turnstile boolean → turnstileWidget pass/fail; null/malformed forms → null", () => {
    const on = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: true },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(on).turnstileWidget).toBe("pass");

    const off = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: false },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(off).turnstileWidget).toBe("fail");

    // null forms (older site package / synthetic erroring body) → unknown, never a fail
    const noForms = result({
      details: { ok: false, prismic: null, forms: null, checkedAt: "2026-07-06T00:00:00.000Z" },
    });
    expect(functionHealthResultFromAudit(noForms).turnstileWidget).toBeNull();

    // malformed forms payload (non-boolean turnstile) degrades to null, never throws
    const junk = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { turnstile: "yes" },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(junk).turnstileWidget).toBeNull();
  });

  it("throws for a non-function-health audit", () => {
    expect(() =>
      functionHealthResultFromAudit({ audit: "domain", site: "x", status: "pass", summary: "" }),
    ).toThrow(/Expected a 'function-health'/);
  });
});
