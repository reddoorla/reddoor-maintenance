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
  it("never writes 'pass' from the env-var flag: true → null (unverified), false → 'fail'", () => {
    // `forms.turnstile` is `!!PUBLIC_TURNSTILE_SITE_KEY?.trim()` in the site's own
    // /health (recipes/health-endpoint/template.ts) — a truthiness check on a string
    // that never contacts Cloudflare. On 2026-09-04 a site was deployed with a
    // sitekey belonging to a widget that was FULL at Cloudflare's 10-hostname cap:
    // /health said `turnstile: true`, this wrote "Turnstile widget = pass", and the
    // live widget threw 110200 and minted no token at all. Under `Require Turnstile`
    // that buckets 100% of real leads as spam_auto, and BOTH halves of the guardrail
    // were satisfied by the false pass — the red item needs "fail"
    // (alerts/digest-collectors.ts) and the amber watch needs !== "pass"
    // (dashboard/fleet-cockpit.ts).
    //
    // So the mapping is asymmetric, and sound in both directions: NO key is proof the
    // widget cannot work ("fail"); a key present is NOT proof that it does (null =
    // unverified, which fleet-cockpit already turns into the accept-able amber watch).
    // Only a real browser can earn the "pass" — see form-e2e.
    const on = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: true },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(on).turnstileWidget).toBeNull();

    const off = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: false },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(off).turnstileWidget).toBe("fail");

    // The regression this test exists for: a key that is set but cannot solve is
    // indistinguishable HERE from one that can, so neither may produce "pass".
    const fullWidgetSitekey = result({
      details: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: true },
        checkedAt: "2026-07-06T00:00:00.000Z",
      },
    });
    expect(functionHealthResultFromAudit(fullWidgetSitekey).turnstileWidget).not.toBe("pass");

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
