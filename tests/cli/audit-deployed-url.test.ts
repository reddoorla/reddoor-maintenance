import { describe, it, expect } from "vitest";
import { applyDeployedUrl } from "../../src/cli/commands/audit.js";
import type { Site } from "../../src/types.js";

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
