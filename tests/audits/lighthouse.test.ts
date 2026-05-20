import { describe, it, expect } from "vitest";
import { lighthouseAudit } from "../../src/audits/lighthouse.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

function fakeSpawn(stdout: string, code = 0): SpawnFn {
  return async () => ({ code, stdout, stderr: "" });
}

describe("audits/lighthouse", () => {
  it("passes when LHCI prints no failures", async () => {
    const result = await lighthouseAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(
        JSON.stringify({
          summary: {
            performance: 0.85,
            accessibility: 0.97,
            "best-practices": 0.95,
            seo: 0.95,
          },
          assertionsFailed: 0,
        }),
        0,
      ),
    });
    expect(result.audit).toBe("lighthouse");
    expect(result.status).toBe("pass");
  });

  it("warns when only the performance threshold was missed", async () => {
    const result = await lighthouseAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(
        JSON.stringify({
          summary: {
            performance: 0.5,
            accessibility: 0.97,
            "best-practices": 0.95,
            seo: 0.95,
          },
          assertionsFailed: 1,
          assertions: [
            { category: "performance", level: "warn", message: "performance below 0.7" },
          ],
        }),
        0,
      ),
    });
    expect(result.status).toBe("warn");
  });

  it("fails when an error-level assertion is violated", async () => {
    const result = await lighthouseAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(
        JSON.stringify({
          summary: {
            performance: 0.85,
            accessibility: 0.3,
            "best-practices": 0.95,
            seo: 0.95,
          },
          assertionsFailed: 1,
          assertions: [
            { category: "accessibility", level: "error", message: "accessibility below 0.95" },
          ],
        }),
        1,
      ),
    });
    expect(result.status).toBe("fail");
  });

  it("skips with a clear message when lhci is missing", async () => {
    const result = await lighthouseAudit({
      site: { path: "/fake" },
      spawn: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.status).toBe("skip");
    expect(result.summary).toMatch(/lhci/i);
  });
});
