import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lighthouseAudit } from "../../src/audits/lighthouse.js";
import type { SpawnFn, SpawnResult } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-lh-"));
}

/**
 * Build a fake spawn that mimics real lhci by writing the .lighthouseci/
 * artifacts the audit reads. `manifest` and `assertionResults` are the parsed
 * forms; the spawn writes them as JSON files inside <cwd>/.lighthouseci/.
 */
/**
 * Mimics lhci 0.15+ output: writes one `lhr-<i>.json` per "run" (the audit
 * now scans the directory rather than reading manifest.json, which lhci no
 * longer writes). Each entry's `summary` becomes a `categories.X.score`
 * map in the lhr file.
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
    let i = 0;
    for (const entry of manifest) {
      const categories: Record<string, { score: number }> = {};
      for (const [k, v] of Object.entries(entry.summary)) {
        categories[k] = { score: v };
      }
      await writeFile(
        join(dir, `lhr-${Date.now()}-${i++}.json`),
        JSON.stringify({ requestedUrl: entry.url, finalUrl: entry.url, categories }),
        "utf-8",
      );
    }
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

  describe("per-site URL override", () => {
    /** A spawn that reads the `--config=<path>` lhci was given (the audit
     * deletes it after spawn returns, so we must read it now) and writes a
     * trivial passing manifest. */
    function capturingSpawn(): {
      spawn: SpawnFn;
      getConfigUrls: () => string[];
      getStartServerCommand: () => string;
    } {
      let capturedUrls: string[] | undefined;
      let capturedStartServerCommand: string | undefined;
      const spawn: SpawnFn = async (_cmd, args, opts): Promise<SpawnResult> => {
        const cfgArg = args.find((a) => a.startsWith("--config="));
        if (cfgArg) {
          const cfgPath = cfgArg.slice("--config=".length);
          const raw = await readFile(cfgPath, "utf-8");
          const cfg = JSON.parse(raw) as {
            ci: { collect: { url: string[]; startServerCommand: string } };
          };
          capturedUrls = cfg.ci.collect.url;
          capturedStartServerCommand = cfg.ci.collect.startServerCommand;
        }
        const cwd = opts?.cwd ?? process.cwd();
        const dir = join(cwd, ".lighthouseci");
        await mkdir(dir, { recursive: true });
        // lhci 0.15+ writes lhr-*.json (not manifest.json) — the audit
        // scans for these.
        await writeFile(
          join(dir, "lhr-1.json"),
          JSON.stringify({
            requestedUrl: "x",
            categories: { performance: { score: 1 }, accessibility: { score: 1 } },
          }),
          "utf-8",
        );
        await writeFile(join(dir, "assertion-results.json"), "[]", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      };
      const getConfigUrls = () => {
        if (!capturedUrls) throw new Error("spawn was never called");
        return capturedUrls;
      };
      const getStartServerCommand = () => {
        if (!capturedStartServerCommand) throw new Error("spawn was never called");
        return capturedStartServerCommand;
      };
      return { spawn, getConfigUrls, getStartServerCommand };
    }

    /**
     * The audit allocates a dynamic free port (caltex 2026-05-28 zombie-vite
     * incident). Assertions check `localhost` + path + valid port shape
     * rather than a literal 5173 string.
     */
    function expectLocalhostUrl(actual: string, expectedPath: string): number {
      const u = new URL(actual);
      expect(u.hostname).toBe("localhost");
      expect(u.pathname).toBe(expectedPath);
      const port = Number(u.port);
      expect(port).toBeGreaterThan(1024);
      expect(port).toBeLessThan(65_536);
      return port;
    }

    it("uses package.json#reddoor.lighthouseUrl when present (path preserved, port rewritten)", async () => {
      const cwd = await tmpSite();
      await writeFile(
        join(cwd, "package.json"),
        JSON.stringify({
          name: "caltex-landing",
          reddoor: { lighthouseUrl: "http://localhost:5173/" },
        }),
      );
      const { spawn, getConfigUrls } = capturingSpawn();
      const result = await lighthouseAudit({ site: { path: cwd }, spawn });
      expect(result.status).toBe("pass");
      const urls = getConfigUrls();
      expect(urls).toHaveLength(1);
      const port = expectLocalhostUrl(urls[0]!, "/");
      // The default 5173 must NOT be passed to lhci — that's the zombie-vite
      // failure mode this fix exists to prevent.
      expect(port).not.toBe(5173);
    });

    it("falls back to the default URL when package.json has no reddoor key", async () => {
      const cwd = await tmpSite();
      await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "untouched" }));
      const { spawn, getConfigUrls } = capturingSpawn();
      await lighthouseAudit({ site: { path: cwd }, spawn });
      const urls = getConfigUrls();
      expect(urls).toHaveLength(1);
      expectLocalhostUrl(urls[0]!, "/dev/a11y-fixtures");
    });

    it("falls back to the default URL when no package.json exists at all", async () => {
      const cwd = await tmpSite();
      const { spawn, getConfigUrls } = capturingSpawn();
      await lighthouseAudit({ site: { path: cwd }, spawn });
      const urls = getConfigUrls();
      expect(urls).toHaveLength(1);
      expectLocalhostUrl(urls[0]!, "/dev/a11y-fixtures");
    });
  });

  // Regression for the caltex 2026-05-28 incident: zombie vite processes on
  // 5173 caused the audit to silently probe a stale server. Hardening pins
  // the dev server to a freshly-allocated port and forces `--strictPort` so
  // vite fails loudly if anything else is squatting on it.
  describe("port hardening (caltex zombie-vite regression)", () => {
    it("startServerCommand passes the allocated port + --strictPort to vite, matching the URL port", async () => {
      const cwd = await tmpSite();
      let capturedStartCommand: string | undefined;
      let capturedUrls: string[] | undefined;
      const spawn: SpawnFn = async (_cmd, args, opts): Promise<SpawnResult> => {
        const cfgArg = args.find((a) => a.startsWith("--config="));
        if (cfgArg) {
          const cfgPath = cfgArg.slice("--config=".length);
          const raw = await readFile(cfgPath, "utf-8");
          const cfg = JSON.parse(raw) as {
            ci: { collect: { url: string[]; startServerCommand: string } };
          };
          capturedStartCommand = cfg.ci.collect.startServerCommand;
          capturedUrls = cfg.ci.collect.url;
        }
        const cwd2 = opts?.cwd ?? process.cwd();
        await mkdir(join(cwd2, ".lighthouseci"), { recursive: true });
        await writeFile(
          join(cwd2, ".lighthouseci", "lhr-1.json"),
          JSON.stringify({ requestedUrl: "x", categories: { performance: { score: 1 } } }),
          "utf-8",
        );
        await writeFile(join(cwd2, ".lighthouseci", "assertion-results.json"), "[]", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      };
      await lighthouseAudit({ site: { path: cwd }, spawn });
      expect(capturedStartCommand).toBeDefined();
      expect(capturedUrls).toBeDefined();
      // The vite spawn args have to include --strictPort so vite refuses to
      // bump on collision — without it, a zombie steals the audit.
      expect(capturedStartCommand!).toMatch(/--strictPort\b/);
      const portMatch = capturedStartCommand!.match(/--port\s+(\d+)/);
      expect(portMatch).not.toBeNull();
      const startPort = Number(portMatch![1]);
      // And the URL lhci probes must point at the SAME port — otherwise
      // we'd start vite on N and audit something else.
      const urlPort = Number(new URL(capturedUrls![0]!).port);
      expect(urlPort).toBe(startPort);
    });
  });

  describe("deployed-URL mode (no dev server)", () => {
    /** A spawn that captures the lhci `ci` config block and the cwd it ran in,
     * then writes a 3-run passing result so the audit's parser succeeds. */
    function captureCiSpawn(): {
      spawn: SpawnFn;
      getCi: () => {
        collect: {
          url: string[];
          numberOfRuns: number;
          startServerCommand?: string;
          settings: { preset: string };
        };
        upload: { target: string };
      };
      getCwd: () => string | undefined;
    } {
      let ci: ReturnType<ReturnType<typeof captureCiSpawn>["getCi"]> | undefined;
      let cwdUsed: string | undefined;
      const spawn: SpawnFn = async (_cmd, args, opts): Promise<SpawnResult> => {
        const cfgArg = args.find((a) => a.startsWith("--config="));
        if (cfgArg) {
          const raw = await readFile(cfgArg.slice("--config=".length), "utf-8");
          ci = (JSON.parse(raw) as { ci: typeof ci }).ci;
        }
        cwdUsed = opts?.cwd;
        const dir = join(opts?.cwd ?? process.cwd(), ".lighthouseci");
        await mkdir(dir, { recursive: true });
        for (let i = 0; i < 3; i++) {
          await writeFile(
            join(dir, `lhr-${i}.json`),
            JSON.stringify({
              requestedUrl: "https://www.caltexmedical.com/",
              categories: {
                performance: { score: 0.92 },
                accessibility: { score: 1 },
                "best-practices": { score: 0.78 },
                seo: { score: 0.92 },
              },
            }),
            "utf-8",
          );
        }
        await writeFile(join(dir, "assertion-results.json"), "[]", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      };
      return {
        spawn,
        getCi: () => {
          if (!ci) throw new Error("spawn was never called with a --config");
          return ci;
        },
        getCwd: () => cwdUsed,
      };
    }

    it("audits the deployed URL directly with no startServerCommand", async () => {
      const { spawn, getCi } = captureCiSpawn();
      const result = await lighthouseAudit({
        site: { path: "/does/not/exist", deployedUrl: "https://www.caltexmedical.com/" },
        spawn,
      });
      expect(result.status).toBe("pass");
      const ci = getCi();
      expect(ci.collect.url).toEqual(["https://www.caltexmedical.com/"]);
      expect(ci.collect.startServerCommand).toBeUndefined();
      expect(ci.collect.numberOfRuns).toBe(3);
      expect(ci.collect.settings.preset).toBe("desktop");
      const details = result.details as { summary: Record<string, number> };
      expect(details.summary["best-practices"]).toBeCloseTo(0.78);
    });

    it("never uses site.path as the lhci cwd (no checkout required)", async () => {
      const { spawn, getCwd } = captureCiSpawn();
      await lighthouseAudit({
        site: { path: "/does/not/exist/checkout", deployedUrl: "https://x.example/" },
        spawn,
      });
      expect(getCwd()).toBeDefined();
      expect(getCwd()).not.toBe("/does/not/exist/checkout");
    });

    it("uploads to the filesystem, never public storage (no 200 public uploads at fleet scale)", async () => {
      const { spawn, getCi } = captureCiSpawn();
      await lighthouseAudit({ site: { path: "/x", deployedUrl: "https://x.example/" }, spawn });
      expect(getCi().upload.target).toBe("filesystem");
    });
  });

  // Regression for the caltex 2026-05-28 (0.10.5) dogfood failure: lhci
  // 0.15+ no longer writes `manifest.json`. The audit used to read it
  // directly and report "no manifest written" against perfectly healthy
  // runs. It now scans for `lhr-*.json` files and builds the equivalent.
  describe("lhci 0.15+ output (no manifest.json)", () => {
    it("reads scores from lhr-*.json when manifest.json is absent", async () => {
      const cwd = await tmpSite();
      const spawn: SpawnFn = async (_cmd, _args, opts): Promise<SpawnResult> => {
        const dir = join(opts?.cwd ?? cwd, ".lighthouseci");
        await mkdir(dir, { recursive: true });
        // Two runs, no manifest.json — matches what real lhci 0.15.1 writes.
        await writeFile(
          join(dir, "lhr-1.json"),
          JSON.stringify({
            requestedUrl: "http://localhost:5173/dev/a11y-fixtures",
            categories: {
              performance: { score: 0.8 },
              accessibility: { score: 0.95 },
              "best-practices": { score: 0.9 },
              seo: { score: 1 },
            },
          }),
          "utf-8",
        );
        await writeFile(
          join(dir, "lhr-2.json"),
          JSON.stringify({
            requestedUrl: "http://localhost:5173/dev/a11y-fixtures",
            categories: {
              performance: { score: 0.9 },
              accessibility: { score: 0.97 },
              "best-practices": { score: 0.92 },
              seo: { score: 1 },
            },
          }),
          "utf-8",
        );
        await writeFile(join(dir, "assertion-results.json"), "[]", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      };
      const result = await lighthouseAudit({ site: { path: cwd }, spawn });
      expect(result.status).toBe("pass");
      const details = result.details as { summary: Record<string, number> };
      // Averaged across two lhr files.
      expect(details.summary.performance).toBeCloseTo(0.85);
      expect(details.summary.accessibility).toBeCloseTo(0.96);
    });

    it("reports a clear failure when neither manifest nor lhr-*.json was written", async () => {
      const cwd = await tmpSite();
      const spawn: SpawnFn = async (_cmd, _args, opts): Promise<SpawnResult> => {
        // Empty .lighthouseci/ — simulates lhci failing before writing
        // any artifacts.
        await mkdir(join(opts?.cwd ?? cwd, ".lighthouseci"), { recursive: true });
        return { code: 1, stdout: "", stderr: "vite spawn failed" };
      };
      const result = await lighthouseAudit({ site: { path: cwd }, spawn });
      expect(result.status).toBe("fail");
      // Error message must reflect the actual filename we look for now,
      // not the stale "no manifest written" string.
      expect(result.summary).toMatch(/lhr-\*\.json/);
      expect(result.summary).toMatch(/vite spawn failed/);
    });

    it("ignores non-lhr files in .lighthouseci/ (links.json, html reports, etc.)", async () => {
      const cwd = await tmpSite();
      const spawn: SpawnFn = async (_cmd, _args, opts): Promise<SpawnResult> => {
        const dir = join(opts?.cwd ?? cwd, ".lighthouseci");
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, "lhr-1.json"),
          JSON.stringify({
            requestedUrl: "http://localhost:5173/x",
            categories: { accessibility: { score: 1 } },
          }),
          "utf-8",
        );
        // These are real artifacts lhci writes alongside lhr-*.json; the
        // scanner must not try to JSON-parse the HTML or pick links.json
        // up as a phantom run entry.
        await writeFile(join(dir, "lhr-1.html"), "<html>not json</html>", "utf-8");
        await writeFile(join(dir, "links.json"), JSON.stringify({ x: "y" }), "utf-8");
        await writeFile(join(dir, "assertion-results.json"), "[]", "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      };
      const result = await lighthouseAudit({ site: { path: cwd }, spawn });
      expect(result.status).toBe("pass");
      const details = result.details as { summary: Record<string, number> };
      expect(details.summary.accessibility).toBe(1);
    });
  });
});
