import { describe, it, expect } from "vitest";
import { a11yAudit } from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

function fakeSpawn(stdout: string, code = 0): SpawnFn {
  return async () => ({ code, stdout, stderr: "" });
}

describe("audits/a11y", () => {
  it("passes when playwright reports no violations", async () => {
    const result = await a11yAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(JSON.stringify({ totalViolations: 0, byImpact: {} }), 0),
    });
    expect(result.audit).toBe("a11y");
    expect(result.status).toBe("pass");
  });

  it("warns for minor/moderate-only violations", async () => {
    const result = await a11yAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(
        JSON.stringify({ totalViolations: 3, byImpact: { minor: 1, moderate: 2 } }),
        1,
      ),
    });
    expect(result.status).toBe("warn");
  });

  it("fails when any serious or critical violation exists", async () => {
    const result = await a11yAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn(JSON.stringify({ totalViolations: 1, byImpact: { critical: 1 } }), 1),
    });
    expect(result.status).toBe("fail");
  });

  it("skips when playwright is missing", async () => {
    const result = await a11yAudit({
      site: { path: "/fake" },
      spawn: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.status).toBe("skip");
  });
});
