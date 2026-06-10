import { describe, it, expect } from "vitest";
import {
  applyDeployedUrl,
  deployedUrlNotice,
  auditNeedsCheckout,
  parseConcurrency,
} from "../../src/cli/commands/audit.js";
import type { AuditName, Site } from "../../src/types.js";

describe("applyDeployedUrl", () => {
  it("returns sites unchanged when url is undefined", () => {
    const sites: Site[] = [{ path: "/a" }, { path: "/b" }];
    expect(applyDeployedUrl(sites, undefined)).toBe(sites);
  });

  it("sets deployedUrl on the single resolved site", () => {
    const out = applyDeployedUrl([{ path: "/a", name: "Acme" }], "https://acme.example/");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ path: "/a", name: "Acme", deployedUrl: "https://acme.example/" });
  });

  it("rejects --url when more than one site resolved (exitCode 2)", () => {
    try {
      applyDeployedUrl([{ path: "/a" }, { path: "/b" }], "https://x/");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/exactly one site/i);
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("rejects --url when zero sites resolved (exitCode 2)", () => {
    try {
      applyDeployedUrl([], "https://x/");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("rejects a malformed --url with exitCode 2 before stamping", () => {
    try {
      applyDeployedUrl([{ path: "/a" }], "not-a-url");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/not a valid url/i);
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });
});

describe("deployedUrlNotice", () => {
  it("returns null when no --url is given", () => {
    expect(deployedUrlNotice(["lighthouse", "deps"] as AuditName[], undefined, "/repo")).toBeNull();
  });

  it("returns null when only lighthouse ran (the intended pairing)", () => {
    expect(deployedUrlNotice(["lighthouse"] as AuditName[], "https://x/", "/repo")).toBeNull();
  });

  it("names the non-lighthouse audits that ran against the local checkout", () => {
    const note = deployedUrlNotice(
      ["lighthouse", "deps", "a11y"] as AuditName[],
      "https://x/",
      "/repo/site",
    );
    expect(note).toMatch(/--url only affects lighthouse/i);
    expect(note).toContain("deps");
    expect(note).toContain("a11y");
    expect(note).toContain("/repo/site");
  });
});

describe("auditNeedsCheckout", () => {
  it("is false for a deployedUrl site auditing lighthouse only (no checkout needed)", () => {
    expect(auditNeedsCheckout({ path: "/x", deployedUrl: "https://x/" }, ["lighthouse"])).toBe(
      false,
    );
  });

  it("is true when a non-lighthouse audit is also requested", () => {
    expect(
      auditNeedsCheckout({ path: "/x", deployedUrl: "https://x/" }, ["lighthouse", "deps"]),
    ).toBe(true);
  });

  it("is true when the site has no deployedUrl", () => {
    expect(auditNeedsCheckout({ path: "/x" }, ["lighthouse"])).toBe(true);
  });
});

describe("parseConcurrency", () => {
  it("returns true (all-parallel) when unset", () => {
    expect(parseConcurrency(undefined)).toBe(true);
  });

  it("parses a positive integer", () => {
    expect(parseConcurrency("1")).toBe(1);
    expect(parseConcurrency("4")).toBe(4);
  });

  it("rejects zero, negatives, and non-integers with exitCode 2", () => {
    for (const bad of ["0", "-2", "abc", "1.5"]) {
      try {
        parseConcurrency(bad);
        throw new Error(`should have thrown for ${bad}`);
      } catch (e) {
        expect((e as { exitCode?: number }).exitCode).toBe(2);
      }
    }
  });
});
