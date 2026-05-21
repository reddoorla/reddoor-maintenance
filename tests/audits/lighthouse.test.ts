import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lighthouseAudit } from "../../src/audits/lighthouse.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-lh-"));
}

/**
 * Build a fake spawn that mimics real lhci by writing the .lighthouseci/
 * artifacts the audit reads. `manifest` and `assertionResults` are the parsed
 * forms; the spawn writes them as JSON files inside <cwd>/.lighthouseci/.
 */
function lhciSpawn(
  manifest: Array<{ url: string; summary: Record<string, number>; htmlPath?: string }>,
  assertionResults?: Array<{
    name: string;
    actual: number;
    expected: number;
    operator: string;
    passed: boolean;
    level: "warn" | "error";
    auditProperty?: string;
    auditId?: string;
  }>,
  spawnExitCode = 0,
): SpawnFn {
  return async (_cmd, _args, opts) => {
    const cwd = opts?.cwd ?? process.cwd();
    const dir = join(cwd, ".lighthouseci");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest), "utf-8");
    if (assertionResults) {
      await writeFile(
        join(dir, "assertion-results.json"),
        JSON.stringify(assertionResults),
        "utf-8",
      );
    }
    return { code: spawnExitCode, stdout: "", stderr: "" };
  };
}

describe("audits/lighthouse", () => {
  it("passes and surfaces real category scores when lhci writes a clean run", async () => {
    const cwd = await tmpSite();
    const result = await lighthouseAudit({
      site: { path: cwd },
      spawn: lhciSpawn(
        [
          {
            url: "http://localhost:5173/dev/a11y-fixtures",
            summary: {
              performance: 0.85,
              accessibility: 0.97,
              "best-practices": 0.95,
              seo: 0.95,
            },
          },
        ],
        [], // no assertion failures
      ),
    });
    expect(result.audit).toBe("lighthouse");
    expect(result.status).toBe("pass");
    const details = result.details as { summary: Record<string, number> };
    expect(details.summary.accessibility).toBe(0.97);
    expect(details.summary.performance).toBe(0.85);
  });

  it("warns when only warn-level assertions failed", async () => {
    const cwd = await tmpSite();
    const result = await lighthouseAudit({
      site: { path: cwd },
      spawn: lhciSpawn(
        [
          {
            url: "http://localhost:5173/dev/a11y-fixtures",
            summary: {
              performance: 0.5,
              accessibility: 0.97,
              "best-practices": 0.95,
              seo: 0.95,
            },
          },
        ],
        [
          {
            name: "categories:performance",
            actual: 0.5,
            expected: 0.7,
            operator: ">=",
            passed: false,
            level: "warn",
          },
        ],
        // lhci exits non-zero when any assertion fails, even warn-level
        1,
      ),
    });
    expect(result.status).toBe("warn");
  });

  it("fails when an error-level assertion is violated", async () => {
    const cwd = await tmpSite();
    const result = await lighthouseAudit({
      site: { path: cwd },
      spawn: lhciSpawn(
        [
          {
            url: "http://localhost:5173/dev/a11y-fixtures",
            summary: {
              performance: 0.85,
              accessibility: 0.3,
              "best-practices": 0.95,
              seo: 0.95,
            },
          },
        ],
        [
          {
            name: "categories:accessibility",
            actual: 0.3,
            expected: 0.95,
            operator: ">=",
            passed: false,
            level: "error",
          },
        ],
        1,
      ),
    });
    expect(result.status).toBe("fail");
    const details = result.details as {
      assertions: Array<{ level: string; category: string }>;
    };
    expect(details.assertions.some((a) => a.level === "error")).toBe(true);
  });

  it("fails with no-output diagnostic when lhci exits non-zero without writing manifest", async () => {
    const cwd = await tmpSite();
    const result = await lighthouseAudit({
      site: { path: cwd },
      spawn: async () => ({ code: 1, stdout: "", stderr: "boom" }),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toMatch(/no manifest|boom/i);
  });

  it("skips with a clear message when lhci is missing", async () => {
    const cwd = await tmpSite();
    const result = await lighthouseAudit({
      site: { path: cwd },
      spawn: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result.status).toBe("skip");
    expect(result.summary).toMatch(/lhci/i);
  });
});
