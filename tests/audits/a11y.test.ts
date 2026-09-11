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

  // Regression for the data-dynamiq 2026-06-09 blank-screen incident: build +
  // SSR succeeded, but client hydration threw a TDZ ReferenceError (a Svelte
  // 4->5 `run()` referencing a $state declared after it), wiping the page. axe
  // over /dev fixtures never saw it. The audit now smoke-loads `/` and fails on
  // any uncaught client-side exception.
  it("smoke-checks the homepage for client-side (hydration) errors", async () => {
    const cwd = await tmpSite();
    let specContents = "";
    await a11yAudit({
      site: { path: cwd },
      spawn: async (_cmd, args, opts) => {
        specContents = await readFile(args[args.length - 1] as string, "utf-8");
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
    // Registers an uncaught-exception listener and navigates the homepage.
    expect(specContents).toMatch(/pageerror/);
    expect(specContents).toMatch(/"path":\s*"\/"/);
  });

  it("fails when a client-error (hydration) violation is reported", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { critical: 1 },
          violations: [{ id: "client-error", impact: "critical", route: "home" }],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
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

// Real-route scanning (2026-08-01). The audit only ever axe-scanned two synthetic
// fixture pages, which is how a critical `image-alt` violation shipped to five
// production pages on gallerysonder with CI green throughout. A site opts in via
// `package.json#reddoor.a11yRoutes`; without the key nothing changes, because the
// audit runs with --fail-on-violations in the shared CI workflow and most of the
// fleet has pre-existing debt.
describe("audits/a11y — per-site real routes", () => {
  /** Capture the generated spec source instead of running Playwright. */
  function captureSpec(): { spawn: SpawnFn; source: () => string } {
    let src = "";
    const spawn: SpawnFn = async (_cmd, args, opts) => {
      const specPath = args[args.length - 1] as string;
      src = await readFile(specPath, "utf-8");
      const cwd = opts?.cwd ?? process.cwd();
      await mkdir(join(cwd, ".reddoor-a11y"), { recursive: true });
      await writeFile(
        join(cwd, ".reddoor-a11y", "results.json"),
        JSON.stringify({ totalViolations: 0, byImpact: {} }),
        "utf-8",
      );
      return { code: 0, stdout: "", stderr: "" };
    };
    return { spawn, source: () => src };
  }

  const writePkg = (dir: string, reddoor?: unknown) =>
    writeFile(
      join(dir, "package.json"),
      JSON.stringify(reddoor ? { name: "site", reddoor } : { name: "site" }),
    );

  it("scans only the fixtures when the site has not opted in", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd);
    const { spawn, source } = captureSpec();
    const result = await a11yAudit({ site: { path: cwd }, spawn });
    expect(result.status).toBe("pass");

    const spec = source();
    expect(spec).toContain("/dev/a11y-fixtures");
    expect(spec).toContain("/dev/animate-in");
    // No real route smuggled into the axe list.
    expect(spec).not.toContain("/about");
  });

  it("adds the configured routes to the axe list, keeping the fixtures", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/", "/about", "/rsvp/euphorbia"] });
    const { spawn, source } = captureSpec();
    await a11yAudit({ site: { path: cwd }, spawn });

    const spec = source();
    expect(spec).toContain("/dev/a11y-fixtures");
    expect(spec).toContain("/dev/animate-in");
    expect(spec).toContain("/rsvp/euphorbia");
    expect(spec).toContain('"/about"');
  });

  it("names each configured route by its path so violations are attributable", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/rsvp/euphorbia"] });
    const { spawn, source } = captureSpec();
    await a11yAudit({ site: { path: cwd }, spawn });

    // The spec tags every violation with `route: name`, so the name has to
    // identify the page — an audit that reports "violation on route 3" is useless.
    expect(source()).toContain('{"path":"/rsvp/euphorbia","name":"/rsvp/euphorbia"}');
  });

  it("survives a malformed opt-in without changing behaviour", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: "not-an-array" });
    const { spawn, source } = captureSpec();
    const result = await a11yAudit({ site: { path: cwd }, spawn });
    expect(result.status).toBe("pass");
    expect(source()).toContain("/dev/a11y-fixtures");
    expect(source()).not.toContain("not-an-array");
  });
});

// The summary string (#697). The merge above was always correct and always
// tested; what nothing asserted was the sentence the operator actually reads,
// which counted the fixture defaults instead of the list that ran. A site that
// opted in was told its routes had not — identical output to before the key
// existed — on the one command used to confirm the opt-in worked. Telling "2"
// from "2 + 0" needs a fixture whose config contributes routes, which is why no
// existing test could have caught it.
describe("audits/a11y — what the summary reports", () => {
  const writePkg = (dir: string, reddoor?: unknown) =>
    writeFile(
      join(dir, "package.json"),
      JSON.stringify(reddoor ? { name: "site", reddoor } : { name: "site" }),
    );

  const clean = () => playwrightSpawn({ totalViolations: 0, byImpact: {} }, 0);

  it("counts the routes that ran, not the fixture defaults", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/", "/es", "/about", "/es/about"] });
    const result = await a11yAudit({ site: { path: cwd }, spawn: clean() });

    // 2 fixtures + 4 configured. Before the fix this said "across 2 routes".
    expect(result.summary).toContain("across 6 routes");
    expect(result.summary).not.toContain("across 2 routes");
  });

  it("names the split, so the operator can see their own routes arrived", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/", "/es", "/about", "/es/about"] });
    const result = await a11yAudit({ site: { path: cwd }, spawn: clean() });
    expect(result.summary).toContain("(2 fixtures + 4 from package.json)");
  });

  it("leaves a site with no opt-in reading exactly as it did", async () => {
    // The whole fleet bar a handful is this case, and it should not churn.
    const cwd = await tmpSite();
    await writePkg(cwd);
    const result = await a11yAudit({ site: { path: cwd }, spawn: clean() });
    expect(result.summary).toBe("a11y: 0 violations across 2 routes (+1 hydration smoke)");
  });

  it("reports coverage on the fail path too, which carried no count at all", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/", "/about"] });
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 2,
          byImpact: { critical: 2 },
          violations: [
            { id: "image-alt", impact: "critical", route: "/" },
            { id: "image-alt", impact: "critical", route: "/about" },
          ],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
    // Was bare "a11y: 2 violations" — no way to tell what it had covered.
    expect(result.summary).toBe(
      "a11y: 2 violations across 4 routes (2 fixtures + 2 from package.json)",
    );
  });

  it("does not claim site routes when the key is present but unusable", async () => {
    // readSiteConfig rejects a non-array; the summary must not then advertise a
    // split that did not happen.
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: "not-an-array" });
    const result = await a11yAudit({ site: { path: cwd }, spawn: clean() });
    expect(result.summary).toBe("a11y: 0 violations across 2 routes (+1 hydration smoke)");
  });
});
