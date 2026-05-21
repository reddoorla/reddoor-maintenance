import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { a11yAudit } from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-a11y-test-"));
}

type A11yArtifact = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
  violations?: Array<{ id: string; impact: string; route: string }>;
};

/**
 * Build a fake spawn that mimics the Playwright spec the audit writes:
 * it writes the JSON artifact to <cwd>/.reddoor-a11y/results.json and exits.
 */
function playwrightSpawn(artifact: A11yArtifact, spawnExitCode = 0): SpawnFn {
  return async (_cmd, _args, opts) => {
    const cwd = opts?.cwd ?? process.cwd();
    const dir = join(cwd, ".reddoor-a11y");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "results.json"), JSON.stringify(artifact), "utf-8");
    return { code: spawnExitCode, stdout: "", stderr: "" };
  };
}

describe("audits/a11y", () => {
  it("passes when no violations are written", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {} }, 0),
    });
    expect(result.audit).toBe("a11y");
    expect(result.status).toBe("pass");
  });

  it("warns for minor/moderate-only violations", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 3,
          byImpact: { minor: 1, moderate: 2 },
          violations: [
            { id: "color-contrast", impact: "moderate", route: "fixtures" },
            { id: "color-contrast", impact: "moderate", route: "fixtures" },
            { id: "label", impact: "minor", route: "animate-in" },
          ],
        },
        // Playwright exits non-zero when the test fails, but the audit
        // should classify by impact, not by exit code alone.
        1,
      ),
    });
    expect(result.status).toBe("warn");
    const details = result.details as A11yArtifact;
    expect(details.totalViolations).toBe(3);
    expect(details.byImpact.moderate).toBe(2);
  });

  it("fails when any serious or critical violation exists", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { critical: 1 },
          violations: [{ id: "aria-required-attr", impact: "critical", route: "fixtures" }],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
  });

  it("surfaces individual violation entries in details for fleet reports", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { critical: 1 },
          violations: [{ id: "aria-required-attr", impact: "critical", route: "fixtures" }],
        },
        1,
      ),
    });
    const details = result.details as A11yArtifact;
    expect(details.violations).toHaveLength(1);
    expect(details.violations?.[0]?.id).toBe("aria-required-attr");
  });

  it("fails with a clear diagnostic when playwright exits non-zero without writing results", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: async () => ({ code: 1, stdout: "", stderr: "spec failed to compile" }),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toMatch(/no results|spec failed/i);
  });

  it("skips when playwright is missing", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.status).toBe("skip");
  });

  it("writes a spec with a generous per-test timeout (survives many routes)", async () => {
    const cwd = await tmpSite();
    let specContents = "";
    const { readFile } = await import("node:fs/promises");
    await a11yAudit({
      site: { path: cwd },
      spawn: async (_cmd, args, opts) => {
        const specPath = args[args.length - 1] as string;
        specContents = await readFile(specPath, "utf-8");
        const out = join(opts?.cwd ?? cwd, ".reddoor-a11y");
        await mkdir(out, { recursive: true });
        await writeFile(
          join(out, "results.json"),
          JSON.stringify({ totalViolations: 0, byImpact: {} }),
          "utf-8",
        );
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    // Playwright's default per-test timeout is 30s; multi-route loops easily
    // exceed it. Ensure the generated spec raises the ceiling.
    expect(specContents).toMatch(/test\.setTimeout\s*\(/);
  });
});
