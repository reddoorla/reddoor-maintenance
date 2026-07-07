import { describe, it, expect } from "vitest";
import { formE2eAudit, type FormRunner } from "../../src/audits/form-e2e.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");
const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

function runner(over: Partial<FormRunner> = {}): FormRunner {
  return {
    submit: async () => ({ formPresent: true, success: true }),
    ...over,
  };
}

describe("audits/form-e2e", () => {
  it("skips (no details) a site with no deployed URL", async () => {
    const r = await formE2eAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  it("skips (no details) a deployed site when no runner is injected and the live gate is off", async () => {
    const originalEnv = process.env.REDDOOR_FORM_E2E_LIVE;
    delete process.env.REDDOOR_FORM_E2E_LIVE;
    try {
      const r = await formE2eAudit({ site, now: NOW });
      expect(r.status).toBe("skip");
      expect(r.details).toBeUndefined();
      expect(r.summary).toMatch(/live form-e2e disabled/);
      expect(r.summary).toMatch(/REDDOOR_FORM_E2E_LIVE/);
    } finally {
      if (originalEnv === undefined) delete process.env.REDDOOR_FORM_E2E_LIVE;
      else process.env.REDDOOR_FORM_E2E_LIVE = originalEnv;
    }
  });

  it("does NOT consult the live gate when a formRunner is injected (tests always run)", async () => {
    const originalEnv = process.env.REDDOOR_FORM_E2E_LIVE;
    delete process.env.REDDOOR_FORM_E2E_LIVE;
    try {
      const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
      expect(r.status).toBe("pass");
    } finally {
      if (originalEnv === undefined) delete process.env.REDDOOR_FORM_E2E_LIVE;
      else process.env.REDDOOR_FORM_E2E_LIVE = originalEnv;
    }
  });

  it("passes when the synthetic submission succeeds", async () => {
    const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", formPresent: true, checkedAt: NOW.toISOString() });
  });

  it("warns + records ok:fail when the submission does not succeed", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({
        submit: async () => ({ formPresent: true, success: false, detail: "no success banner" }),
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ ok: "fail", formPresent: true });
    expect(r.summary).toMatch(/no success banner/);
  });

  it("records n/a (ok:null + fresh checkedAt) when the site has no contact form", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({ submit: async () => ({ formPresent: false }) }),
    });
    // Skip STATUS (nothing to assert on the CLI), but WITH details so the writer
    // persists the n/a signal: null verdict + fresh checkedAt (Plan 4 reads that as n/a).
    expect(r.status).toBe("skip");
    expect(r.details).toEqual({ ok: null, formPresent: false, checkedAt: NOW.toISOString() });
  });

  it("passes the CF public test sitekey + testMode marker to the runner", async () => {
    let seen: { baseUrl: string; testMode: boolean; testSitekey: string } | undefined;
    await formE2eAudit({
      site,
      now: NOW,
      formRunner: {
        submit: async (opts) => {
          seen = opts;
          return { formPresent: true, success: true };
        },
      },
    });
    expect(seen).toEqual({
      baseUrl: "https://acme.example.com",
      testMode: true,
      testSitekey: "1x00000000000000000000AA",
    });
  });
});
