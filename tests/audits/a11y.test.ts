import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
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

  // Regression for the caltex 2026-05-28 zombie-vite incident: relying on
  // the site's own playwright.config (port 5173, no strictPort) let the
  // audit silently probe a stale dev server. Hardening synthesizes its own
  // config with a freshly-allocated port + `--strictPort`.
  describe("port hardening (caltex zombie-vite regression)", () => {
    it("synthesizes a playwright config pinning the dev server to a free port with --strictPort", async () => {
      const cwd = await tmpSite();
      let capturedConfigPath: string | undefined;
      let capturedConfig = "";
      await a11yAudit({
        site: { path: cwd },
        spawn: async (_cmd, args, opts) => {
          const cfgArg = args.find((a) => a.startsWith("--config="));
          expect(cfgArg).toBeDefined();
          capturedConfigPath = cfgArg!.slice("--config=".length);
          capturedConfig = await readFile(capturedConfigPath, "utf-8");
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
      // The synthesized config must force strictPort — without it, vite
      // happily bumps to a free port and the audit hits a zombie on 5173.
      expect(capturedConfig).toMatch(/--strictPort\b/);
      // The vite spawn port and the URL playwright polls must match —
      // otherwise we'd start vite on N and probe something else.
      const cmdPortMatch = capturedConfig.match(/--port\s+(\d+)/);
      expect(cmdPortMatch).not.toBeNull();
      const cmdPort = Number(cmdPortMatch![1]);
      const urlPortMatch = capturedConfig.match(/url:\s*"http:\/\/localhost:(\d+)/);
      expect(urlPortMatch).not.toBeNull();
      const urlPort = Number(urlPortMatch![1]);
      const baseUrlPortMatch = capturedConfig.match(/baseURL:\s*"http:\/\/localhost:(\d+)/);
      expect(baseUrlPortMatch).not.toBeNull();
      const baseUrlPort = Number(baseUrlPortMatch![1]);
      expect(cmdPort).toBe(urlPort);
      expect(cmdPort).toBe(baseUrlPort);
      // And the port must NOT be the historic 5173 — that's the zombie
      // failure surface the fix exists to eliminate.
      expect(cmdPort).not.toBe(5173);
      // reuseExistingServer:false ensures the audit owns the server lifecycle
      // (don't piggyback on something already listening).
      expect(capturedConfig).toMatch(/reuseExistingServer:\s*false/);
    });

    // Regression for caltex 2026-05-28 (0.10.5) dogfood: the synthesized
    // config lives in /tmp, so playwright's default webServer.cwd was the
    // tmp dir. `npm run vite:dev` then ENOENT'd on /tmp/.../package.json
    // before vite ever started. The config must pin webServer.cwd to the
    // site's path so npm finds the right project.
    it("pins webServer.cwd to the site's path so `npm run vite:dev` finds package.json", async () => {
      const cwd = await tmpSite();
      let capturedConfig = "";
      await a11yAudit({
        site: { path: cwd },
        spawn: async (_cmd, args, opts) => {
          const cfgArg = args.find((a) => a.startsWith("--config="));
          capturedConfig = await readFile(cfgArg!.slice("--config=".length), "utf-8");
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
      // JSON.stringify escapes the path → `cwd: "/private/var/.../reddoor-a11y-test-XXX"`.
      expect(capturedConfig).toContain(`cwd: ${JSON.stringify(cwd)}`);
    });

    // Regression for caltex 2026-05-28 (0.10.6) dogfood: the spec file
    // does `import AxeBuilder from "@axe-core/playwright"`. Node resolves
    // from the spec's directory and walks up looking for node_modules. A
    // spec in /tmp finds no node_modules and the audit fails before any
    // test runs. Writing the specDir INSIDE site.path lets the walk-up
    // resolve to the site's installed dependencies.
    it("writes the specDir inside site.path so spec imports resolve via the site's node_modules", async () => {
      const cwd = await tmpSite();
      let capturedSpecPath: string | undefined;
      let capturedConfigPath: string | undefined;
      await a11yAudit({
        site: { path: cwd },
        spawn: async (_cmd, args, opts) => {
          capturedSpecPath = args[args.length - 1] as string;
          const cfgArg = args.find((a) => a.startsWith("--config="));
          capturedConfigPath = cfgArg!.slice("--config=".length);
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
      expect(capturedSpecPath).toBeDefined();
      expect(capturedConfigPath).toBeDefined();
      // Both spec + synthesized config must live inside site.path so they
      // share the site's node_modules during module resolution.
      expect(capturedSpecPath!.startsWith(cwd + "/")).toBe(true);
      expect(capturedConfigPath!.startsWith(cwd + "/")).toBe(true);
    });
  });
});
