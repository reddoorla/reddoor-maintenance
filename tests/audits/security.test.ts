import { describe, it, expect } from "vitest";
import { securityAudit } from "../../src/audits/security.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

function fakeSpawn(
  byCmd: Record<string, { code: number; stdout: string; stderr?: string }>,
): SpawnFn {
  return async (cmd) => {
    const r = byCmd[cmd];
    if (!r) throw new Error(`ENOENT: ${cmd}`);
    return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? "" };
  };
}

describe("audits/security", () => {
  it("returns pass when pnpm audit reports zero vulnerabilities", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
  });

  it("returns warn for moderate-only vulnerabilities", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 2, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("warn");
  });

  it("returns fail for any high or critical", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("fail");
  });

  it("falls back to npm audit when pnpm is missing", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        npm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/npm audit/);
  });

  it("returns skip when neither pnpm nor npm is available", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("skip");
  });
});
