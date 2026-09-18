import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  a11yAudit,
  classifyRouteResponse,
  describeSkipped,
  describeViolations,
} from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-a11y-test-"));
}

type A11yArtifact = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
  violations?: Array<{ id: string; impact: string; route: string; help?: string }>;
  skipped?: Array<{ route: string; path: string; status: number | null; reason: string }>;
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
      "a11y: 2 violations across 4 routes (2 fixtures + 2 from package.json) — image-alt on /, image-alt on /about",
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

// #680: a fixture route that 404s used to be scanned as if it existed — axe ran
// over the error page and the summary reported a count with no route and no
// rule, so a config problem read as a markup problem and was bisected as one.
describe("audits/a11y — a route that 404s is a missing route, not a scan (#680)", () => {
  const specCapturingSpawn = (sink: { spec: string }): SpawnFn => {
    return async (_cmd, args, opts) => {
      const specPath = args[args.length - 1] as string;
      sink.spec = await readFile(specPath, "utf-8");
      const out = join(opts?.cwd ?? process.cwd(), ".reddoor-a11y");
      await mkdir(out, { recursive: true });
      await writeFile(
        join(out, "results.json"),
        JSON.stringify({ totalViolations: 0, byImpact: {} }),
        "utf-8",
      );
      return { code: 0, stdout: "", stderr: "" };
    };
  };

  it("emits a spec that guards every axe navigation on a 200 and skips axe otherwise", async () => {
    const cwd = await tmpSite();
    const sink = { spec: "" };
    await a11yAudit({ site: { path: cwd }, spawn: specCapturingSpawn(sink) });
    // The navigation's response is captured, not discarded.
    expect(sink.spec).toMatch(/const response = await page\.goto\(path\)/);
    // A missing or non-200 response becomes its own violation id …
    expect(sink.spec).toMatch(/const verdict = classifyRouteResponse\(/);
    expect(sink.spec).toMatch(/if \(verdict === "missing"\)/);
    expect(sink.spec).toContain('id: "route-missing"');
    expect(sink.spec).toContain('impact: "serious"');
    // … whose help names the path and the status …
    expect(sink.spec).toMatch(/returned \$\{status === null \? "no response" : status\}/);
    // … and axe is NOT run over whatever the error page was.
    const guardAt = sink.spec.indexOf('id: "route-missing"');
    const continueAt = sink.spec.indexOf("continue;", guardAt);
    const axeAt = sink.spec.indexOf("new AxeBuilder({ page })", guardAt);
    expect(continueAt).toBeGreaterThan(guardAt);
    expect(axeAt).toBeGreaterThan(continueAt);
  });

  it("fails on a route-missing violation and names the route and status in the summary", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { serious: 1 },
          violations: [
            {
              id: "route-missing",
              impact: "serious",
              route: "animate-in demo",
              help: "/dev/animate-in returned 404",
            },
          ],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
    // Was "a11y: 1 violations across 2 routes" — no route, no rule, no status.
    expect(result.summary).toContain(
      "route-missing on animate-in demo (/dev/animate-in returned 404)",
    );
  });

  it("names the rule id and route for real axe violations too", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 3,
          byImpact: { serious: 3 },
          violations: [
            { id: "color-contrast", impact: "serious", route: "a11y fixtures" },
            { id: "color-contrast", impact: "serious", route: "a11y fixtures" },
            { id: "image-alt", impact: "serious", route: "/" },
          ],
        },
        1,
      ),
    });
    expect(result.summary).toBe(
      "a11y: 3 violations across 2 routes — color-contrast ×2 on a11y fixtures, image-alt on /",
    );
  });
});

describe("audits/a11y — describeViolations", () => {
  it("groups identical rule+route pairs and caps the list", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `rule-${i}`,
      impact: "minor" as const,
      route: "/",
    }));
    const text = describeViolations(many);
    expect(text).toContain("rule-0 on /");
    expect(text).toContain("rule-5 on /");
    expect(text).not.toContain("rule-6 on /");
    expect(text).toMatch(/\+3 more$/);
  });

  it("carries the help text only for route-missing, where it holds the status", () => {
    const text = describeViolations([
      { id: "route-missing", impact: "serious", route: "x", help: "/x returned 404" },
      {
        id: "color-contrast",
        impact: "serious",
        route: "y",
        help: "Elements must have sufficient color contrast",
      },
    ]);
    expect(text).toBe("route-missing on x (/x returned 404), color-contrast on y");
  });

  it("is empty for no violations", () => {
    expect(describeViolations([])).toBe("");
  });
});

/**
 * gateServer (#700). The synthesized config started the site with `vite dev`,
 * so the one browser that ever opens a fleet site in CI never opened the
 * shipped bundle. Hydration is the clearest case: a hydration smoke run against
 * `vite dev` cannot fail the way production fails, because the module graph,
 * code splitting, minification and asset hashing are most of what "hydration
 * works" means.
 *
 * The design, and why it is not a straight swap. The axe scan targets
 * `/dev/a11y-fixtures` and `/dev/animate-in`, and those are not guaranteed to
 * survive a production build — under a build that excludes them, #680's
 * route-status guard would correctly report every fixture as a missing route,
 * and a working gate would become a red one measuring nothing. So the opt-in
 * splits the run: axe keeps the dev server (fast, and the fixtures certainly
 * exist there), and the hydration smoke — the part dev actually hides — gets a
 * built preview on its own port.
 */
describe("audits/a11y — gateServer opt-in (#700)", () => {
  function capture(): { spawn: SpawnFn; spec: () => string; config: () => string } {
    let specSrc = "";
    let configSrc = "";
    const spawn: SpawnFn = async (_cmd, args, opts) => {
      specSrc = await readFile(args[args.length - 1] as string, "utf-8");
      const cfgArg = args.find((a) => a.startsWith("--config="));
      configSrc = await readFile(cfgArg!.slice("--config=".length), "utf-8");
      const cwd = opts?.cwd ?? process.cwd();
      await mkdir(join(cwd, ".reddoor-a11y"), { recursive: true });
      await writeFile(
        join(cwd, ".reddoor-a11y", "results.json"),
        JSON.stringify({ totalViolations: 0, byImpact: {} }),
        "utf-8",
      );
      return { code: 0, stdout: "", stderr: "" };
    };
    return { spawn, spec: () => specSrc, config: () => configSrc };
  }

  const writePkg = (dir: string, reddoor?: unknown) =>
    writeFile(
      join(dir, "package.json"),
      JSON.stringify(reddoor ? { name: "site", reddoor } : { name: "site" }),
    );

  const devPortOf = (config: string) => Number(config.match(/vite:dev -- --port (\d+)/)![1]);
  const previewPortOf = (config: string) =>
    Number(config.match(/npm run preview -- --port (\d+)/)![1]);

  // The grant side. Every fleet site is a non-adopter until it opts in, so the
  // default path has to stay exactly what it was.
  it("default: a single dev webServer, and the smoke routes ride its baseURL", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd);
    const { spawn, spec, config } = capture();
    const result = await a11yAudit({ site: { path: cwd }, spawn });
    expect(result.status).toBe("pass");

    expect(config()).toContain("npm run vite:dev -- --port");
    expect(config()).not.toContain("npm run build");
    expect(config()).not.toContain("npm run preview");
    // One server, not an array.
    expect(config()).toMatch(/webServer:\s*\{/);
    // Smoke navigation stays relative to baseURL — no second origin.
    expect(spec()).not.toContain("http://localhost:");
  });

  it("preview: axe keeps the dev server so the fixtures still resolve", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "preview" });
    const { spawn, spec, config } = capture();
    await a11yAudit({ site: { path: cwd }, spawn });

    // baseURL is what the axe loop navigates against (relative paths), and it
    // must still be the dev server — that is the whole point of the split.
    const baseURLPort = Number(config().match(/baseURL:\s*"http:\/\/localhost:(\d+)"/)![1]);
    expect(baseURLPort).toBe(devPortOf(config()));
    expect(spec()).toContain("/dev/a11y-fixtures");
  });

  it("preview: the hydration smoke gets a built preview on its own port", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "preview" });
    const { spawn, spec, config } = capture();
    await a11yAudit({ site: { path: cwd }, spawn });

    expect(config()).toMatch(/webServer:\s*\[/);
    const preview = previewPortOf(config());
    expect(config()).toContain(
      `npm run build && npm run preview -- --port ${preview} --strictPort`,
    );
    // Two servers cannot share a port.
    expect(preview).not.toBe(devPortOf(config()));
    // The smoke loop must aim at the preview origin absolutely, or it would
    // silently fall back to baseURL — i.e. to dev — and measure nothing new.
    expect(spec()).toContain(`http://localhost:${preview}`);
  });

  it("preview: both servers keep --strictPort, the site cwd and never-reuse", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "preview" });
    const { spawn, config } = capture();
    await a11yAudit({ site: { path: cwd }, spawn });

    expect(config().match(/--strictPort/g)).toHaveLength(2);
    expect(config().match(/reuseExistingServer:\s*false/g)).toHaveLength(2);
    expect(config().match(new RegExp(`cwd: ${JSON.stringify(cwd)}`, "g"))).toHaveLength(2);
    // The preview server has to be probed on a route a production build
    // certainly serves — never a /dev/* fixture.
    const preview = previewPortOf(config());
    expect(config()).toContain(`url: "http://localhost:${preview}/"`);
  });

  // #697's lesson: an opt-in that does not say it took effect gets reverted as
  // broken. The summary is the one line an operator reads to confirm it.
  it("preview: the summary says the smoke ran against a production build", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "preview" });
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {} }, 0),
    });
    expect(result.summary).toMatch(/production preview/);
  });

  it("default: the summary is unchanged", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd);
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {} }, 0),
    });
    expect(result.summary).toBe("a11y: 0 violations across 2 routes (+1 hydration smoke)");
  });

  // A preview run pays for a production build before the first navigation. The
  // 5-minute budget was sized for "boot vite, then run axe"; leaving it there
  // would SIGKILL opted-in sites mid-build and report it as an audit failure.
  it("preview: the playwright spawn gets a budget that covers the build", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "preview" });
    let previewBudget = 0;
    let devBudget = 0;
    const record = (into: (n: number) => void): SpawnFn => {
      return async (_cmd, args, opts) => {
        into(opts?.timeoutMs ?? 0);
        const out = join(opts?.cwd ?? cwd, ".reddoor-a11y");
        await mkdir(out, { recursive: true });
        await writeFile(
          join(out, "results.json"),
          JSON.stringify({ totalViolations: 0, byImpact: {} }),
          "utf-8",
        );
        void args;
        return { code: 0, stdout: "", stderr: "" };
      };
    };
    await a11yAudit({ site: { path: cwd }, spawn: record((n) => (previewBudget = n)) });

    const devCwd = await tmpSite();
    await writePkg(devCwd);
    await a11yAudit({ site: { path: devCwd }, spawn: record((n) => (devBudget = n)) });

    expect(devBudget).toBe(5 * 60_000);
    expect(previewBudget).toBeGreaterThan(devBudget);
  });

  it("an unrecognized gateServer value runs the dev path", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { gateServer: "prod" });
    const { spawn, config } = capture();
    const result = await a11yAudit({ site: { path: cwd }, spawn });
    expect(result.status).toBe("pass");
    expect(config()).toContain("npm run vite:dev -- --port");
    expect(config()).not.toContain("npm run preview");
  });
});

/**
 * #863 — sentinel awareness. The route-status guard (#680) is right that a
 * configured route returning non-200 is a config problem. What it did not know
 * is that a 404 on `/` is the DESIGNED answer for a clone still carrying the
 * starter's `your-prismic-repo-name`: there is no Prismic repository behind it
 * until `/new-site` step 6, so `getByUID("page","home")` cannot resolve.
 *
 * Every new site passes through that window — step 3c points the gates at real
 * routes, step 6 wires Prismic — and in it the first maintenance PR failed on
 * `route-missing on / (/ returned 404)`, which is not a defect in the site.
 *
 * The danger in fixing it is fixing it too broadly. reddoor-starter sits on the
 * sentinel PERMANENTLY, and it is the repo the `/dev/*` fixtures live in; a rule
 * that tolerated any 404 on a placeholder site would stop checking the fixtures
 * exactly where they are defined. So the two 404 flavours are tested together,
 * on the same site, in both directions.
 */
describe("audits/a11y — a placeholder-repo 404 is the designed answer (#863)", () => {
  const writePkg = (dir: string, reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  const writePrismic = (dir: string, repositoryName: string, file = "slicemachine.config.json") =>
    writeFile(join(dir, file), JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }));

  function captureSpec(sink: { spec: string }, artifact: A11yArtifact): SpawnFn {
    return async (_cmd, args, opts) => {
      sink.spec = await readFile(args[args.length - 1] as string, "utf-8");
      const out = join(opts?.cwd ?? process.cwd(), ".reddoor-a11y");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "results.json"), JSON.stringify(artifact), "utf-8");
      return { code: artifact.totalViolations > 0 ? 1 : 0, stdout: "", stderr: "" };
    };
  }

  type SpecPage = { path: string; name: string; placeholder404Ok?: boolean };
  const pagesOf = (spec: string): SpecPage[] => {
    const matched = spec.match(/\nconst pages = (\[.*?\]);\n/)?.[1];
    // Not a soft fallback: if the spec stops declaring `pages` the way this
    // reads it, every assertion below would quietly measure an empty list.
    if (!matched) throw new Error("generated spec has no `const pages = [...]` line");
    return JSON.parse(matched) as SpecPage[];
  };

  async function specFor(repo: string | null, routes: string[]): Promise<string> {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: routes });
    if (repo) await writePrismic(cwd, repo);
    const sink = { spec: "" };
    await a11yAudit({
      site: { path: cwd },
      spawn: captureSpec(sink, { totalViolations: 0, byImpact: {} }),
    });
    return sink.spec;
  }

  // The decision itself, as a table. This is the function the spec runs — see
  // the identity test below — so this table is evidence about the shipped
  // guard, not about a transcription of it.
  it("classifies: 200 scans, a tolerated 404 skips, everything else is still missing", () => {
    expect(classifyRouteResponse({ status: 200, placeholder404Ok: false })).toBe("scan");
    expect(classifyRouteResponse({ status: 200, placeholder404Ok: true })).toBe("scan");
    // The one new branch.
    expect(classifyRouteResponse({ status: 404, placeholder404Ok: true })).toBe("skip");
    // #680's behaviour, untouched.
    expect(classifyRouteResponse({ status: 404, placeholder404Ok: false })).toBe("missing");
    // "No content yet" is a 404. A placeholder site whose dev server throws, or
    // whose navigation dies, is still broken — blanket non-200 tolerance would
    // swallow both.
    expect(classifyRouteResponse({ status: 500, placeholder404Ok: true })).toBe("missing");
    expect(classifyRouteResponse({ status: 503, placeholder404Ok: true })).toBe("missing");
    expect(classifyRouteResponse({ status: null, placeholder404Ok: true })).toBe("missing");
  });

  it("the generated spec runs that exact function, not a copy of it", async () => {
    const spec = await specFor("your-prismic-repo-name", ["/"]);
    expect(spec).toContain(classifyRouteResponse.toString());
  });

  it("marks the site's own routes tolerable and the /dev fixtures never", async () => {
    const pages = pagesOf(await specFor("your-prismic-repo-name", ["/", "/about"]));
    expect(pages.map((p) => [p.path, p.placeholder404Ok === true])).toEqual([
      ["/dev/a11y-fixtures", false],
      ["/dev/animate-in", false],
      ["/", true],
      ["/about", true],
    ]);
  });

  it("marks nothing on a site wired to a real Prismic repository", async () => {
    const pages = pagesOf(await specFor("caltex-industrial", ["/"]));
    expect(pages.some((p) => p.placeholder404Ok === true)).toBe(false);
  });

  it("marks nothing when the site has no Prismic config at all", async () => {
    const pages = pagesOf(await specFor(null, ["/"]));
    expect(pages.some((p) => p.placeholder404Ok === true)).toBe(false);
  });

  // The trap this test exists for: `PLACEHOLDER_REPOSITORY_NAMES` in
  // src/prismic/models/config.ts also holds `reddoor-wireframer`, and
  // data-dynamiq really is served from it — the repository resolves and has
  // published documents. Reusing that list here would hand a LIVE production
  // site permanent, silent tolerance of a 404 on its homepage.
  it("does not treat reddoor-wireframer as a placeholder — data-dynamiq renders from it", async () => {
    const pages = pagesOf(await specFor("reddoor-wireframer", ["/"]));
    expect(pages.some((p) => p.placeholder404Ok === true)).toBe(false);
  });

  // The whole loop, both flavours, on the SAME freshly bootstrapped site: the
  // real pages array the audit generated, run through the real classifier.
  it("on one placeholder site: / skips, and a fixture 404 on that same site does not", async () => {
    const pages = pagesOf(await specFor("your-prismic-repo-name", ["/"]));
    const run = (statusOf: (p: SpecPage) => number) =>
      pages.map((p) =>
        classifyRouteResponse({
          status: statusOf(p),
          placeholder404Ok: p.placeholder404Ok === true,
        }),
      );

    // Known-good input — a site between /new-site step 3c and step 6. Fixtures
    // serve (the #717 /dev guard is inert under `vite dev`); `/` has no content.
    expect(run((p) => (p.path === "/" ? 404 : 200))).toEqual(["scan", "scan", "skip"]);

    // The real defect on that same site: a fixture route stops answering.
    expect(run((p) => (p.path === "/" || p.path.startsWith("/dev/") ? 404 : 200))).toEqual([
      "missing",
      "missing",
      "skip",
    ]);

    // And the tolerance does not widen into "any non-200 on a placeholder
    // site": a homepage that 500s is a crash, not an absence of content.
    expect(run((p) => (p.path === "/" ? 500 : 200))).toEqual(["scan", "scan", "missing"]);
  });

  // PASS PROOF, end to end. A skip must not be able to read as a scan: the
  // count becomes "2 of 3" and the note names the route and the reason.
  it("passes on the placeholder 404 and says out loud that the route was not scanned", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/"] });
    await writePrismic(cwd, "your-prismic-repo-name");
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn({
        totalViolations: 0,
        byImpact: {},
        violations: [],
        skipped: [{ route: "/", path: "/", status: 404, reason: "placeholder Prismic repo" }],
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toBe(
      "a11y: 0 violations across 2 of 3 routes " +
        "(2 fixtures + 1 from package.json; 1 skipped: / — placeholder Prismic repo) " +
        "(+1 hydration smoke)",
    );
  });

  // FAIL PROOF, end to end, on the SAME configuration: the fixture 404 is not
  // covered by the sentinel and still fails serious.
  it("still fails on a fixture 404 on a placeholder site", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/"] });
    await writePrismic(cwd, "your-prismic-repo-name");
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { serious: 1 },
          violations: [
            {
              id: "route-missing",
              impact: "serious",
              route: "a11y fixtures",
              help: "/dev/a11y-fixtures returned 404",
            },
          ],
          skipped: [{ route: "/", path: "/", status: 404, reason: "placeholder Prismic repo" }],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
    // Both facts survive into the one line CI and the cockpit read.
    expect(result.summary).toBe(
      "a11y: 1 violations across 2 of 3 routes " +
        "(2 fixtures + 1 from package.json; 1 skipped: / — placeholder Prismic repo) " +
        "— route-missing on a11y fixtures (/dev/a11y-fixtures returned 404)",
    );
  });

  // #680, unchanged where it matters most: a real site's broken homepage.
  it("still fails on a 404 on a site wired to a real Prismic repository", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/"] });
    await writePrismic(cwd, "caltex-industrial");
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { serious: 1 },
          violations: [
            { id: "route-missing", impact: "serious", route: "/", help: "/ returned 404" },
          ],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toBe(
      "a11y: 1 violations across 3 routes (2 fixtures + 1 from package.json) " +
        "— route-missing on / (/ returned 404)",
    );
  });

  it("a run that skipped nothing keeps its summary byte-for-byte", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, { a11yRoutes: ["/"] });
    await writePrismic(cwd, "your-prismic-repo-name");
    const result = await a11yAudit({
      site: { path: cwd },
      // The site is on the sentinel, but `/` answered 200 — nothing to skip.
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {}, violations: [], skipped: [] }),
    });
    expect(result.summary).toBe(
      "a11y: 0 violations across 3 routes (2 fixtures + 1 from package.json) (+1 hydration smoke)",
    );
  });
});

describe("audits/a11y — describeSkipped", () => {
  const skip = (route: string, reason = "placeholder Prismic repo") => ({
    route,
    path: route,
    status: 404,
    reason,
  });

  it("is empty when nothing was skipped", () => {
    expect(describeSkipped([])).toBe("");
  });

  it("names the route and the reason", () => {
    expect(describeSkipped([skip("/")])).toBe("1 skipped: / — placeholder Prismic repo");
  });

  it("caps the named list and keeps the count honest", () => {
    const many = ["/", "/a", "/b", "/c", "/d", "/e"].map((r) => skip(r));
    expect(describeSkipped(many)).toBe(
      "6 skipped: /, /a, /b, /c, +2 more — placeholder Prismic repo",
    );
  });

  it("does not repeat one reason per route", () => {
    expect(describeSkipped([skip("/"), skip("/about")])).toBe(
      "2 skipped: /, /about — placeholder Prismic repo",
    );
  });
});
