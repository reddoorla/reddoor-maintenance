import { describe, it, expect } from "vitest";
import {
  hasNetlifyDeployResult,
  netlifyDeployResultFromAudit,
} from "../../src/audits/netlify-deploy-airtable.js";
import type { AuditResult } from "../../src/types.js";

function result(over: Partial<AuditResult> = {}): AuditResult {
  return {
    audit: "netlify-deploy",
    site: "acme",
    status: "pass",
    summary: "deploy ready",
    details: {
      state: "ready",
      deployedAt: "2026-06-17T12:00:00.000Z",
      logUrl: "https://acme.netlify.app",
      checkedAt: "2026-06-18T00:00:00.000Z",
    },
    ...over,
  };
}

describe("hasNetlifyDeployResult", () => {
  it("is true for a netlify-deploy audit with a details payload", () => {
    expect(hasNetlifyDeployResult(result())).toBe(true);
  });
  it("is false for a non-netlify-deploy audit", () => {
    expect(
      hasNetlifyDeployResult({ audit: "lighthouse", site: "x", status: "pass", summary: "" }),
    ).toBe(false);
  });
  it("is false for a skipped netlify-deploy audit (no details)", () => {
    expect(hasNetlifyDeployResult(result({ status: "skip", details: undefined }))).toBe(false);
  });
});

describe("netlifyDeployResultFromAudit", () => {
  it("extracts state + deployedAt + logUrl + checkedAt", () => {
    expect(netlifyDeployResultFromAudit(result())).toEqual({
      state: "ready",
      deployedAt: "2026-06-17T12:00:00.000Z",
      logUrl: "https://acme.netlify.app",
      checkedAt: "2026-06-18T00:00:00.000Z",
    });
  });
  it("maps null deploy fields (degraded probe) to null", () => {
    const r = result({
      status: "warn",
      details: {
        state: null,
        deployedAt: null,
        logUrl: null,
        checkedAt: "2026-06-18T00:00:00.000Z",
      },
    });
    const out = netlifyDeployResultFromAudit(r);
    expect(out.state).toBeNull();
    expect(out.deployedAt).toBeNull();
    expect(out.logUrl).toBeNull();
    expect(out.checkedAt).toBe("2026-06-18T00:00:00.000Z");
  });
  it("throws on a non-netlify-deploy audit", () => {
    expect(() =>
      netlifyDeployResultFromAudit({ audit: "domain", site: "x", status: "pass", summary: "" }),
    ).toThrow(/Expected a 'netlify-deploy'/);
  });
});
