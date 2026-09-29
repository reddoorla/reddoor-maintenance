import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  a11yAudit,
  classifyRouteResponse,
  describeFrameNodesDropped,
  describeReveals,
  describeSkipped,
  describeThirdPartyErrors,
  describeViolations,
  type RevealRecord,
} from "../../src/audits/a11y.js";
import { revealBelowFold } from "../../src/audits/util/reveal-below-fold.js";
import {
  collectFrameErrorLogs,
  firstStackUrl,
  frameOnPathIsForeign,
  isForeignUrl,
  recordFrameErrors,
  resolveTargetElement,
  splitCrossOriginFrameNodes,
  splitThirdPartyErrors,
} from "../../src/audits/util/cross-origin.js";
import {
  contrastUnmeasuredHelp,
  ruleErroredHelp,
  unparseableColourRemedy,
  unparseableContrastNodes,
} from "../../src/audits/util/contrast-unmeasured.js";
import { readAxeResults } from "../../src/audits/util/axe-results.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-a11y-test-"));
}

type A11yArtifact = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
  violations?: Array<{ id: string; impact: string; route: string; help?: string }>;
  skipped?: Array<{ route: string; path: string; status: number | null; reason: string }>;
  measured?: Array<{ route: string; ruleNodes: Record<string, number> }>;
  reveals?: RevealRecord[];
  frameNodesDropped?: Array<{ route: string; count: number; rules: string[] }>;
  thirdPartyErrors?: Array<{
    route: string;
    frame?: string;
    source: string | null;
    message: string;
  }>;
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

  // #100 review: an error thrown while the reveal pass ran is labelled with
  // that time window (not a cause) and kept apart from errors outside it.
  it("marks a client error thrown while the reveal pass ran, and never folds it into one thrown outside it", () => {
    const line = describeViolations([
      { id: "client-error", impact: "critical", route: "/", help: "boom" },
      {
        id: "client-error",
        impact: "critical",
        route: "/",
        help: "while the reveal pass ran: map failed",
      },
      {
        id: "client-error",
        impact: "critical",
        route: "/",
        help: "while the reveal pass ran: map failed again",
      },
    ]);
    expect(line).toBe("client-error on /, client-error ×2 on / (while the reveal pass ran)");
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

/**
 * #900 — a fixture route the site does not define is not a missing route.
 *
 * The route-status guard (#680) is right that a configured route returning a
 * 404 is a config problem. It assumed every site defines both built-in
 * fixtures. Eight do not: seven ship no `animateIn` action at all, so
 * `/dev/animate-in` exercises code that is not there, and the eighth
 * (reddoor-website) ships the action without the fixture. All eight were green
 * only while their pinned `@reddoorla/maintenance` predated #807.
 *
 * Skipping that 404 is right. Skipping it SILENTLY is not, and that is the
 * whole shape of this block. Absence is inferred from the tree being audited,
 * and a tree cannot tell "never had it" from "deleted last Tuesday" — the
 * second used to be a loud red on the seventeen sites that do ship the
 * fixture, and this repo's own CLAUDE.md names a merge that deletes starter
 * files as "clean, CONFLICT-FREE removals" with nothing to warn you. So an
 * undeclared absence is a `warn`, and `package.json#reddoor.absentFixtures` is
 * how a site says "on purpose" and earns its clean pass back.
 */
describe("audits/a11y — a fixture the site does not define is not a missing route (#900)", () => {
  const writePkg = (dir: string, reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  /** Give the temp site a real `src/routes` tree holding exactly `names` under /dev. */
  async function writeDevFixtures(
    dir: string,
    names: string[],
    prefix: string[] = [],
  ): Promise<void> {
    await mkdir(join(dir, "src", "routes"), { recursive: true });
    for (const name of names) {
      const routeDir = join(dir, "src", "routes", ...prefix, "dev", name);
      await mkdir(routeDir, { recursive: true });
      await writeFile(join(routeDir, "+page.svelte"), "<h1>fixture</h1>");
    }
  }

  function captureSpec(sink: { spec: string }, artifact: A11yArtifact): SpawnFn {
    return async (_cmd, args, opts) => {
      sink.spec = await readFile(args[args.length - 1] as string, "utf-8");
      const out = join(opts?.cwd ?? process.cwd(), ".reddoor-a11y");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "results.json"), JSON.stringify(artifact), "utf-8");
      return { code: artifact.totalViolations > 0 ? 1 : 0, stdout: "", stderr: "" };
    };
  }

  const CLEAN: A11yArtifact = { totalViolations: 0, byImpact: {} };
  const SKIPPED_ANIMATE = {
    route: "animate-in demo",
    path: "/dev/animate-in",
    status: 404,
    reason: "fixture not in this site's source",
  };

  type SpecPage = {
    path: string;
    name: string;
    placeholder404Ok?: boolean;
    sourceAbsent?: boolean;
  };
  const pagesOf = (spec: string): SpecPage[] => {
    const matched = spec.match(/\nconst pages = (\[.*?\]);\n/)?.[1];
    if (!matched) throw new Error("generated spec has no `const pages = [...]` line");
    return JSON.parse(matched) as SpecPage[];
  };

  let siteDir = "";
  async function auditSite(
    build: (dir: string) => Promise<void>,
    artifact: A11yArtifact = CLEAN,
  ): Promise<{ pages: SpecPage[]; result: Awaited<ReturnType<typeof a11yAudit>> }> {
    const cwd = await tmpSite();
    siteDir = cwd;
    await build(cwd);
    const sink = { spec: "" };
    const result = await a11yAudit({ site: { path: cwd }, spawn: captureSpec(sink, artifact) });
    // An empty `pages` means no spec was generated — the audit failed before
    // Playwright. Tests must assert the full list rather than `.some()`, or a
    // fast-fail satisfies them vacuously.
    return { pages: sink.spec ? pagesOf(sink.spec) : [], result };
  }

  // The decision itself, as a table, on the function the spec actually runs.
  it("classifies: a 404 on an absent fixture skips, and every other 404 is still missing", () => {
    expect(
      classifyRouteResponse({ status: 404, placeholder404Ok: false, sourceAbsent: true }),
    ).toBe("skip");
    // #680's behaviour, untouched: the fixture is in the tree and does not answer.
    expect(
      classifyRouteResponse({ status: 404, placeholder404Ok: false, sourceAbsent: false }),
    ).toBe("missing");
    // Absence tolerates a 404 and nothing else. A route with no source that
    // answers 500 means the dev server is broken, not that the route is absent.
    expect(
      classifyRouteResponse({ status: 500, placeholder404Ok: false, sourceAbsent: true }),
    ).toBe("missing");
    expect(
      classifyRouteResponse({ status: null, placeholder404Ok: false, sourceAbsent: true }),
    ).toBe("missing");
    // An absent route that somehow serves is scanned — skipping a 200 would
    // discard a real scan, and it is why a false "absent" costs nothing.
    expect(
      classifyRouteResponse({ status: 200, placeholder404Ok: false, sourceAbsent: true }),
    ).toBe("scan");
    // Omitting the field entirely is the pre-#900 shape and must not change.
    expect(classifyRouteResponse({ status: 404, placeholder404Ok: false })).toBe("missing");
  });

  // PASS CONTROL for the source check. Without it the marking could be
  // unconditional and every test below would still pass.
  it("marks nothing on a site that defines both fixtures", async () => {
    const { pages, result } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures", "animate-in"]);
    });
    expect(pages.map((p) => [p.path, p.sourceAbsent === true])).toEqual([
      ["/dev/a11y-fixtures", false],
      ["/dev/animate-in", false],
    ]);
    expect(result.status).toBe("pass");
  });

  it("marks only the fixture the site does not define", async () => {
    const { pages } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures"]);
    });
    expect(pages.map((p) => [p.path, p.sourceAbsent === true])).toEqual([
      ["/dev/a11y-fixtures", false],
      ["/dev/animate-in", true],
    ]);
  });

  // The heart of it: an inferred absence is never a silent pass.
  it("warns — not passes — when the absence is only inferred from the tree", async () => {
    const { result } = await auditSite(
      async (dir) => {
        await writePkg(dir, {});
        await writeDevFixtures(dir, ["a11y-fixtures"]);
      },
      { totalViolations: 0, byImpact: {}, skipped: [SKIPPED_ANIMATE] },
    );
    expect(result.status).toBe("warn");
    expect(result.summary).toContain("1 of 2 routes");
    expect(result.summary).toContain("animate-in demo");
    expect(result.summary).toContain("fixture not in this site's source");
  });

  // ...and a site that has written the absence down gets its clean pass back.
  it("passes when the site declares the fixture absent on purpose", async () => {
    const { result } = await auditSite(
      async (dir) => {
        await writePkg(dir, { absentFixtures: ["/dev/animate-in"] });
        await writeDevFixtures(dir, ["a11y-fixtures"]);
      },
      { totalViolations: 0, byImpact: {}, skipped: [SKIPPED_ANIMATE] },
    );
    expect(result.status).toBe("pass");
    // Declared or not, the skip is still named. A pass must not become silent.
    expect(result.summary).toContain("1 of 2 routes");
    expect(result.summary).toContain("animate-in demo");
  });

  // A declaration is not tolerance. A declared fixture that IS in the tree is
  // scanned exactly as before, so a stale entry cannot silence a real route.
  it("a declaration does not excuse a fixture that is present", async () => {
    const { pages, result } = await auditSite(async (dir) => {
      await writePkg(dir, { absentFixtures: ["/dev/animate-in"] });
      await writeDevFixtures(dir, ["a11y-fixtures", "animate-in"]);
    });
    expect(pages.some((p) => p.sourceAbsent === true)).toBe(false);
    expect(result.status).toBe("pass");
  });

  it("never marks a route the site opted in through package.json", async () => {
    const { pages } = await auditSite(async (dir) => {
      await writePkg(dir, { a11yRoutes: ["/", "/about"] });
      await writeDevFixtures(dir, ["a11y-fixtures", "animate-in"]);
    });
    expect(
      pages.filter((p) => !p.path.startsWith("/dev/")).map((p) => p.sourceAbsent === true),
    ).toEqual([false, false]);
  });

  it("marks nothing when the site has no src/routes tree to read", async () => {
    const { pages } = await auditSite(async (dir) => {
      await writePkg(dir, {});
    });
    expect(pages.some((p) => p.sourceAbsent === true)).toBe(false);
  });

  // The error path that used to fail OPEN. `stat`/`readdir` throw EACCES,
  // EMFILE, ELOOP and EIO as well as ENOENT, and every one of those means "I
  // could not tell" — under the fd pressure of a concurrent fleet sweep this
  // is how a real 404 would have become a skip.
  it("does not conclude absent when a directory below src/routes is unreadable", async () => {
    const { pages, result } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures", "animate-in"]);
      await chmod(join(dir, "src", "routes", "dev"), 0o000);
      // Restored below, after the audit has read it — an unreadable directory
      // left in the temp tree is a rude thing to leave on a CI runner.
    });
    await chmod(join(siteDir, "src", "routes", "dev"), 0o755).catch(() => {});
    // Asserted as a full list, not with `.some()`. A fail-open here marks the
    // readiness fixture absent too, which fails the audit fast and leaves NO
    // generated spec — and `[].some(...)` is false, so the loose form of this
    // test passed under exactly the mutation it exists to catch.
    expect(pages.map((p) => [p.path, p.sourceAbsent === true])).toEqual([
      ["/dev/a11y-fixtures", false],
      ["/dev/animate-in", false],
    ]);
    expect(result.status).toBe("pass");
  });

  // macOS folds case and Linux does not. SvelteKit URLs are case-sensitive, so
  // a `Dev/` tree genuinely 404s on both — but a `stat` on a joined path would
  // call it present locally and absent on the runner that gates the merge.
  it("matches entry names exactly, so macOS and the Linux runner agree", async () => {
    const { pages } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures"]);
      const wrong = join(dir, "src", "routes", "dev", "Animate-In");
      await mkdir(wrong, { recursive: true });
      await writeFile(join(wrong, "+page.svelte"), "<h1>wrong case</h1>");
    });
    expect(pages.find((p) => p.path === "/dev/animate-in")?.sourceAbsent).toBe(true);
  });

  // A SvelteKit route group is invisible in the URL, so it must be invisible
  // here. Nothing in the fleet wraps /dev in one today; it is handled because
  // the failure it would otherwise cause is silent.
  it("sees a fixture that lives inside a route group", async () => {
    const { pages } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures"]);
      await writeDevFixtures(dir, ["animate-in"], ["(marketing)"]);
    });
    expect(pages.some((p) => p.sourceAbsent === true)).toBe(false);
  });

  // The readiness probe cannot be skipped: Playwright treats >=404 as not
  // ready, so a site missing THIS fixture never reaches the spec — it burns
  // the whole webServer budget and dies naming neither route nor reason.
  it("fails fast and names the route when the readiness fixture is absent", async () => {
    const { result } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["animate-in"]);
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("/dev/a11y-fixtures");
    expect(result.summary).toContain("readiness probe");
  });

  // Declaring it does not buy a way around that.
  it("a declaration cannot excuse the readiness fixture either", async () => {
    const { result } = await auditSite(async (dir) => {
      await writePkg(dir, { absentFixtures: ["/dev/a11y-fixtures"] });
      await writeDevFixtures(dir, ["animate-in"]);
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("/dev/a11y-fixtures");
  });

  // The status and the skip note are computed from two different sources —
  // the filesystem and the run's own artifact — and they can disagree. A path
  // with no directory that still SERVES (a rest route, dev middleware, a
  // `kit.files.routes` override) is scanned normally and records no skip.
  // Downgrading on the filesystem alone produced a `warn` reading "0
  // violations across 2 routes": a warning with nothing in it to act on.
  it("does not warn when the tree says absent but the run scanned the route anyway", async () => {
    const { result } = await auditSite(async (dir) => {
      await writePkg(dir, {});
      await writeDevFixtures(dir, ["a11y-fixtures"]);
    }, CLEAN);
    expect(result.status).toBe("pass");
  });

  // A near-miss declaration used to be silently inert: the site wrote one
  // down, nothing changed, and nothing said why.
  it("accepts a declaration with a missing or trailing slash", async () => {
    for (const declaration of ["/dev/animate-in", "dev/animate-in", "/dev/animate-in/"]) {
      const { result } = await auditSite(
        async (dir) => {
          await writePkg(dir, { absentFixtures: [declaration] });
          await writeDevFixtures(dir, ["a11y-fixtures"]);
        },
        { totalViolations: 0, byImpact: {}, skipped: [SKIPPED_ANIMATE] },
      );
      expect(result.status, `declaration ${JSON.stringify(declaration)}`).toBe("pass");
    }
  });

  // The readiness fast-fail returns early, and every other exit clears the
  // artifact first. A stale results.json must never read as this run's answer.
  it("clears a stale artifact before failing fast on the readiness fixture", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, {});
    await writeDevFixtures(cwd, ["animate-in"]);
    await mkdir(join(cwd, ".reddoor-a11y"), { recursive: true });
    await writeFile(
      join(cwd, ".reddoor-a11y", "results.json"),
      JSON.stringify({ totalViolations: 99, byImpact: {} }),
    );
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: captureSpec({ spec: "" }, CLEAN),
    });
    expect(result.status).toBe("fail");
    await expect(readFile(join(cwd, ".reddoor-a11y", "results.json"), "utf-8")).rejects.toThrow();
  });

  it("the generated spec runs the same classifier, not a copy of it", async () => {
    const cwd = await tmpSite();
    await writePkg(cwd, {});
    await writeDevFixtures(cwd, ["a11y-fixtures"]);
    const sink = { spec: "" };
    await a11yAudit({ site: { path: cwd }, spawn: captureSpec(sink, CLEAN) });
    expect(sink.spec).toContain(classifyRouteResponse.toString());
  });
});

/**
 * #900 — with two reasons live, the summary has to pair each route with its
 * own. They are not interchangeable: a placeholder-repo skip clears itself at
 * `/new-site` step 6, an absent fixture is permanent, and a reader handed one
 * flat list will attach the first reason to every route.
 */
describe("audits/a11y — describeSkipped pairs routes with reasons once reasons differ", () => {
  const skip = (route: string, reason: string) => ({ route, path: route, status: 404, reason });
  const PLACEHOLDER = "placeholder Prismic repo";
  const ABSENT = "fixture not in this site's source";

  // The compact form survives exactly where it cannot mislead.
  it("keeps the compact form while every skip shares one reason", () => {
    expect(describeSkipped([skip("/", PLACEHOLDER), skip("/about", PLACEHOLDER)])).toBe(
      `2 skipped: /, /about — ${PLACEHOLDER}`,
    );
  });

  it("pairs each route with its own reason once they differ", () => {
    expect(describeSkipped([skip("/", PLACEHOLDER), skip("animate-in demo", ABSENT)])).toBe(
      `2 skipped: / (${PLACEHOLDER}), animate-in demo (${ABSENT})`,
    );
  });

  // The regression this test used to lock in: it asserted the count and the
  // first reason, and said nothing about the second — so a reason carried only
  // by a skip past the cap could vanish and the suite stayed green. The
  // compact branch computes reasons over ALL skips; the paired branch must not
  // do less.
  it("keeps every reason when the paired list is capped", () => {
    const many = [
      skip("/", PLACEHOLDER),
      skip("/a", PLACEHOLDER),
      skip("/b", PLACEHOLDER),
      skip("/c", PLACEHOLDER),
      skip("animate-in demo", ABSENT),
    ];
    const line = describeSkipped(many);
    expect(line.startsWith("5 skipped: ")).toBe(true);
    expect(line).toContain("+1 more");
    expect(line).toContain(`/ (${PLACEHOLDER})`);
    // The whole point: the capped skip's reason survives.
    expect(line).toContain(ABSENT);
  });
});

/**
 * #888 — contrast that was never measured, reported as clean.
 *
 * The mechanism has been got wrong twice, in opposite directions, so it is
 * written here as MEASURED against axe-core 4.13.0 in Chromium
 * (`scripts/probe-axe-contrast.mjs` re-runs every row). An unparseable colour
 * — Tailwind 4.3's `oklch(… 0 none)` neutrals, which Chrome renders fine —
 * reaches axe in two shapes, depending on where it sits under the text:
 *
 *   the colour is the first opaque background   -> per node, incomplete,
 *     band on one element : passes=1 incomplete=1   messageKey "colorParse";
 *     same colour on body : passes=0 incomplete=2   the rule runs on elsewhere
 *
 *   the colour sits BENEATH an opaque background -> the rule THROWS for that
 *     white card / CTA inside the coloured band     document: one node with an
 *     (the starter's Hero)                          `error-occurred` check,
 *                                                   0 passes in that document
 *
 * The issue described only the second; the correction posted on it (and this
 * block's previous header) described only the first and called the second
 * impossible. Both occur. The first is `contrast-unmeasured`; the second is
 * `rule-errored`, one per crash node, attributed by the frame it is in.
 *
 * `colorParse` is the right per-node signal because it means the browser
 * understood the colour and axe did not: an instrument failure. The rule's
 * OTHER messageKeys (bgImage, bgGradient, imgNode, elmPartiallyObscured) are
 * properties of the page, where "axe cannot be sure" is the honest answer, and
 * a page with no text makes the rule inapplicable. Neither is a defect, and an
 * earlier cut that keyed on "color-contrast missing from passes" flagged both.
 *
 * These tests hold the audit's handling of the artifact and the pure pieces the
 * spec injects. What axe actually returns is held in a real browser by
 * a11y-live-spec.test.ts ("contrast that was never measured, run for real").
 */
describe("audits/a11y — contrast that was never measured (#888)", () => {
  const writePkg = (dir: string, reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  async function writeDevFixtures(dir: string, names: string[]): Promise<void> {
    await mkdir(join(dir, "src", "routes"), { recursive: true });
    for (const name of names)
      await mkdir(join(dir, "src", "routes", "dev", name), { recursive: true });
  }

  function fakeSpawn(artifact: A11yArtifact, sink?: { spec: string }): SpawnFn {
    return async (_cmd, args, opts) => {
      if (sink) sink.spec = await readFile(args[args.length - 1] as string, "utf-8");
      const out = join(opts?.cwd ?? process.cwd(), ".reddoor-a11y");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "results.json"), JSON.stringify(artifact), "utf-8");
      return { code: artifact.totalViolations > 0 ? 1 : 0, stdout: "", stderr: "" };
    };
  }

  async function run(artifact: A11yArtifact, sink?: { spec: string }) {
    const cwd = await tmpSite();
    await writePkg(cwd, {});
    await writeDevFixtures(cwd, ["a11y-fixtures", "animate-in"]);
    return a11yAudit({ site: { path: cwd }, spawn: fakeSpawn(artifact, sink) });
  }

  // PASS CONTROL: a genuinely clean run must still read `pass`, or every FAIL
  // below is meaningless.
  it("passes a run that measured contrast and found nothing", async () => {
    const r = await run({
      totalViolations: 0,
      byImpact: {},
      measured: [
        { route: "a11y fixtures", ruleNodes: { "color-contrast": 61, region: 3 } },
        { route: "animate-in demo", ruleNodes: { "color-contrast": 12 } },
      ],
    });
    expect(r.status).toBe("pass");
  });

  // The real defect: a violation the exit code can see, naming how many
  // elements went unmeasured and how to fix it.
  it("fails on unparseable-colour nodes and says how many and what to do", async () => {
    const r = await run({
      totalViolations: 1,
      byImpact: { serious: 1 },
      violations: [
        {
          id: "contrast-unmeasured",
          impact: "serious",
          route: "a11y fixtures",
          help: '7 element(s) on a colour axe cannot parse (oklch(0.205 0 none)), so contrast was never measured there — write 0 for "none" in the oklch() token (browsers already render none as 0, so nothing on screen changes)',
        },
      ],
      measured: [{ route: "a11y fixtures", ruleNodes: { "color-contrast": 54 } }],
    });
    expect(r.status).toBe("fail");
    expect(r.summary).toContain("contrast-unmeasured");
    expect(r.summary).toContain("7 element(s)");
    // The remedy has to travel with the finding, or it is just an alarm.
    expect(r.summary).toContain('write 0 for "none" in the oklch() token');
  });

  // #916 review: two rules that threw on one route are two findings. They
  // used to fold into "rule-errored ×2" under the first rule's message.
  it("names each rule that threw on a route, and folds only identical crashes", () => {
    const errored = (rule: string) => ({
      id: "rule-errored",
      impact: "serious" as const,
      route: "/two-crashes",
      help: `axe could not run "${rule}": boom Skipping ${rule} rule.`,
    });
    expect(
      describeViolations([
        errored("color-contrast"),
        errored("document-title"),
        errored("document-title"),
      ]),
    ).toBe(
      'rule-errored on /two-crashes (axe could not run "color-contrast": boom Skipping color-contrast rule.), ' +
        'rule-errored ×2 on /two-crashes (axe could not run "document-title": boom Skipping document-title rule.)',
    );
  });

  // The shape #888 actually reported: the whole rule thrown for the page.
  it("fails on a rule that genuinely threw, naming the rule and axe's message", async () => {
    const r = await run({
      totalViolations: 1,
      byImpact: { serious: 1 },
      violations: [
        {
          id: "rule-errored",
          impact: "serious",
          route: "a11y fixtures",
          help: 'axe could not run "color-contrast": boom',
        },
      ],
    });
    expect(r.status).toBe("fail");
    expect(r.summary).toContain("rule-errored");
    expect(r.summary).toContain("boom");
  });

  // The regression the previous cut shipped: a page whose text sits on a
  // gradient yields color-contrast with ZERO passes, and a page with no text
  // makes the rule inapplicable. Both are healthy. Neither may be reported.
  it("says nothing about a page whose contrast is merely uncertain", async () => {
    for (const measured of [
      [{ route: "a11y fixtures", ruleNodes: { region: 2 } }],
      [{ route: "a11y fixtures", ruleNodes: {} }],
    ]) {
      const r = await run({ totalViolations: 0, byImpact: {}, measured });
      expect(r.status).toBe("pass");
      expect(r.summary).not.toContain("unmeasured");
    }
  });

  // The spec must collect the signal the tests above assume, or they describe
  // a shape nothing produces — which is exactly how the previous cut passed.
  it("the generated spec keys on colorParse, and reads crashes from axe's raw report", async () => {
    const sink = { spec: "" };
    await run({ totalViolations: 0, byImpact: {} }, sink);
    expect(sink.spec).toContain("colorParse");
    expect(sink.spec).toContain("contrast-unmeasured");
    expect(sink.spec).toContain("ruleNodes");
    // The raw report, read by the injected function, and every crash it finds.
    expect(sink.spec).toContain('reporter: "raw"');
    expect(sink.spec).toContain(`const readAxeResults = ${readAxeResults.toString()};`);
    expect(sink.spec).toContain("for (const crash of results.crashes)");
  });

  // Where the detection sits is load-bearing, and only a live run or this can
  // see it. `results` is declared inside the axe loop's try block, and a
  // textual merge of this PR over #950 put the detection AFTER that block's
  // finally: every unit test here stayed green and tsc passed (the spec is a
  // string), while every real audit died on `results is not defined` and
  // reported "no results written". It must read `results` inside the try, and
  // be counted and filtered by the same cross-origin frame split as axe's own
  // violations (#100).
  it("reads axe's results inside the route's try, and splits its findings like axe's own", async () => {
    const sink = { spec: "" };
    await run({ totalViolations: 0, byImpact: {} }, sink);
    const spec = sink.spec;
    const analyze = spec.indexOf(".analyze(),");
    const detect = spec.indexOf("const unparseable = unparseableContrastNodes(results);");
    const errored = spec.indexOf("ruleErroredHelp(crash.rule");
    const split = spec.indexOf("splitCrossOriginFrameNodes(candidates, foreignPaths)");
    const measured = spec.indexOf("measured.push(");
    const loopFinally = spec.indexOf("} finally {", analyze);
    for (const at of [analyze, detect, errored, split, measured, loopFinally]) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(analyze).toBeLessThan(detect);
    expect(detect).toBeLessThan(split);
    expect(errored).toBeLessThan(split);
    expect(split).toBeLessThan(measured);
    expect(measured).toBeLessThan(loopFinally);
    // The derived findings join axe's violations BEFORE the frame paths are
    // walked, so a node inside a third party's frame is dropped and counted.
    expect(spec).toContain("const candidates = [...results.violations, ...derived];");
    expect(spec).toMatch(/for \(const v of candidates\) \{\s+for \(const n of v\.nodes\)/);
  });
});

/**
 * The pure pieces #888's detection is built from, fed the shapes a real axe
 * run returns (see the probe and the live spec test for where each was
 * measured). The live test proves axe produces them; these hold the edges.
 */
const REMEDY =
  'write 0 for "none" in the oklch() token (browsers already render none as 0, so nothing on screen changes)';

describe("audits/a11y — the #888 detection's pure pieces", () => {
  const colorParseCheck = (colour: string) => ({
    id: "color-contrast",
    data: { messageKey: "colorParse", colorParse: colour },
  });
  const keyed = (messageKey: string) => ({ id: "color-contrast", data: { messageKey } });

  it("returns only the color-contrast nodes axe could not parse a colour for", () => {
    const band = { target: ["#band"], any: [colorParseCheck("oklch(0.205 0 none)")] };
    const gradient = { target: ["#gradient"], any: [keyed("bgGradient")] };
    const image = { target: ["#hero"], any: [keyed("imgNode")] };
    const short = { target: ["#x"], any: [keyed("shortTextContent")] };
    const found = unparseableContrastNodes({
      incomplete: [
        { id: "color-contrast", nodes: [band, gradient, image, short] },
        // Another rule's node carrying the same key must not be counted.
        { id: "link-in-text-block", nodes: [{ target: ["#l"], any: [keyed("colorParse")] }] },
      ],
    });
    expect(found).toEqual([band]);
  });

  it("finds the key in any of axe's three check lists, and tolerates null data", () => {
    const inAll = { target: ["#a"], all: [colorParseCheck("oklch(0.5 0 none)")] };
    const inNone = { target: ["#b"], none: [colorParseCheck("oklch(0.5 0 none)")] };
    const noData = { target: ["#c"], any: [{ id: "color-contrast", data: null }, null] };
    expect(
      unparseableContrastNodes({
        incomplete: [{ id: "color-contrast", nodes: [inAll, inNone, noData] }],
      }),
    ).toEqual([inAll, inNone]);
  });

  it("returns nothing when the rule is not incomplete at all", () => {
    expect(unparseableContrastNodes({})).toEqual([]);
    expect(unparseableContrastNodes({ incomplete: [] })).toEqual([]);
    expect(unparseableContrastNodes({ incomplete: [{ id: "color-contrast" }] })).toEqual([]);
  });

  // #916 review (M5): every one of the rule's OTHER incomplete reasons, read
  // from axe's own message table, so a key axe adds is covered the day it
  // ships. Each is a property of the page, and none may be reported.
  it("reports none of color-contrast's other incomplete reasons, as axe itself lists them", () => {
    const fromAxePlaywright = createRequire(
      createRequire(import.meta.url).resolve("@axe-core/playwright"),
    );
    const axe = fromAxePlaywright("axe-core") as {
      _audit: { data: { checks: Record<string, { messages: { incomplete: object } }> } };
    };
    const keys = Object.keys(axe._audit.data.checks["color-contrast"]?.messages.incomplete ?? {});
    // Not vacuous: the one key that IS reported is in axe's table, beside a dozen others.
    expect(keys).toContain("colorParse");
    const others = keys.filter((k) => k !== "colorParse" && k !== "default");
    expect(others.length).toBeGreaterThanOrEqual(10);
    const nodes = others.map((k) => ({ target: [`#${k}`], any: [keyed(k)] }));
    expect(unparseableContrastNodes({ incomplete: [{ id: "color-contrast", nodes }] })).toEqual([]);
  });

  it("names the count, up to two colours axe rejected, and the remedy for the first", () => {
    const node = (colour: string) => ({ any: [colorParseCheck(colour)] });
    expect(
      contrastUnmeasuredHelp(
        [node("oklch(0.205 0 none)"), node("oklch(0.205 0 none)")],
        unparseableColourRemedy,
      ),
    ).toBe(
      `2 element(s) on a colour axe cannot parse (oklch(0.205 0 none)), so contrast was never measured there — ${REMEDY}`,
    );
    expect(
      contrastUnmeasuredHelp(
        [node("oklch(0.205 0 none)"), node("oklch(0.97 0 none)"), node("oklch(0.556 0 none)")],
        unparseableColourRemedy,
      ),
    ).toContain("(oklch(0.205 0 none), oklch(0.97 0 none), +1 more)");
    // The remedy names the colour's own function, not always oklch().
    expect(contrastUnmeasuredHelp([node("hsl(none 0% 50%)")], unparseableColourRemedy)).toContain(
      'write 0 for "none" in the hsl() token',
    );
    // No colour string recorded: still a count and a remedy, no empty "()".
    expect(contrastUnmeasuredHelp([{ any: [keyed("colorParse")] }], unparseableColourRemedy)).toBe(
      "1 element(s) on a colour axe cannot parse, so contrast was never measured there — give the colour token a value axe-core can parse",
    );
  });

  it("gives a thrown rule axe's own message, and the colour's remedy only when a colour caused it", () => {
    expect(
      ruleErroredHelp(
        "color-contrast",
        'Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule.',
        unparseableColourRemedy,
      ),
    ).toBe(
      `axe could not run "color-contrast": Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule. — ${REMEDY}`,
    );
    expect(
      ruleErroredHelp(
        "link-in-text-block",
        'Unable to parse color "lab(50% none 0)" Skipping link-in-text-block rule.',
        unparseableColourRemedy,
      ),
    ).toContain('— write 0 for "none" in the lab() token');
    expect(ruleErroredHelp("region", "boom Skipping region rule.", unparseableColourRemedy)).toBe(
      'axe could not run "region": boom Skipping region rule.',
    );
    expect(ruleErroredHelp("region", undefined, unparseableColourRemedy)).toBe(
      'axe could not run "region": no message from axe',
    );
  });

  // #916 review NIT: the remedy used to say "give the oklch() token an explicit
  // hue" for every colour. It follows the colour's own function now.
  it("words the remedy for the colour function it was given", () => {
    expect(unparseableColourRemedy("oklch(0.205 0 none)")).toBe(REMEDY);
    expect(unparseableColourRemedy("LCH(50% 0 none)")).toContain("in the lch() token");
    expect(unparseableColourRemedy("color(display-p3 none 0 0)")).toContain(
      'write 0 for "none" in the color() token',
    );
    expect(unparseableColourRemedy("light-dark(red, blue)")).toBe(
      "give the light-dark() token a value axe-core can parse",
    );
    expect(unparseableColourRemedy(undefined)).toBe(
      "give the colour token a value axe-core can parse",
    );
  });

  // Injected with toString(), so it must not lean on anything outside itself.
  it("each piece survives serialization into the spec", () => {
    for (const fn of [
      unparseableContrastNodes,
      contrastUnmeasuredHelp,
      ruleErroredHelp,
      unparseableColourRemedy,
      readAxeResults,
    ]) {
      const revived = new Function(`return (${fn.toString()});`)() as typeof fn;
      expect(typeof revived).toBe("function");
    }
    const revivedDetect = new Function(
      `return (${unparseableContrastNodes.toString()});`,
    )() as typeof unparseableContrastNodes;
    const band = { any: [colorParseCheck("oklch(0.205 0 none)")] };
    expect(revivedDetect({ incomplete: [{ id: "color-contrast", nodes: [band] }] })).toEqual([
      band,
    ]);
    const revivedHelp = new Function(
      `return (${ruleErroredHelp.toString()});`,
    )() as typeof ruleErroredHelp;
    const revivedRemedy = new Function(
      `return (${unparseableColourRemedy.toString()});`,
    )() as typeof unparseableColourRemedy;
    expect(
      revivedHelp("color-contrast", 'Unable to parse color "oklch(0.2 0 none)"', revivedRemedy),
    ).toContain('write 0 for "none"');
    const revivedRead = new Function(
      `return (${readAxeResults.toString()});`,
    )() as typeof readAxeResults;
    expect(
      revivedRead([{ id: "r", passes: [{ node: { selector: ["#a"], source: "<a>" } }] }]).passes,
    ).toHaveLength(1);
  });
});

/**
 * #916 review: axe merges each rule's results across frames, and when the rule
 * threw in ANY frame its default (v1) report keeps only the incomplete group.
 * A color-contrast crash inside a third party's embed erased the site's own
 * contrast violations and passes. The audit reads the raw report instead;
 * these hold how it is read. The shapes are the raw reporter's, as axe-core
 * 4.13.0 returns them (a node is `{ node: { selector, source }, any, all,
 * none }`); a11y-live-spec.test.ts holds that a real run produces them.
 */
describe("audits/a11y — axe's raw report, read without losing a thrown rule's results", () => {
  const crashCheck = (message: string) => ({
    id: "error-occurred",
    data: { message, stack: "Error: …" },
  });
  const rawNode = (selector: string[], extra: Record<string, unknown> = {}) => ({
    node: { selector, source: `<p id="${selector.at(-1)}">`, nodeIndexes: [1] },
    any: [],
    all: [],
    none: [],
    impact: "serious",
    ...extra,
  });

  it("keeps a thrown rule's violations and passes, and sets each crash apart with its frame", () => {
    const reading = readAxeResults([
      {
        id: "color-contrast",
        impact: "serious",
        help: "Elements must meet minimum color contrast ratio thresholds",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
        error: { message: "Unable to parse color … Skipping color-contrast rule." },
        violations: [rawNode(["#site-faint"])],
        passes: [rawNode(["h1"]), rawNode(["#site-plain"])],
        incomplete: [
          rawNode(["#site-gradient"], {
            any: [{ id: "color-contrast", data: { messageKey: "bgGradient" } }],
          }),
          rawNode(["#xo-crash", "a"], {
            none: [
              crashCheck(
                'Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule.',
              ),
            ],
          }),
        ],
      },
    ]);
    expect(reading.violations.map((r) => [r.id, r.nodes.map((n) => n.target)])).toEqual([
      ["color-contrast", [["#site-faint"]]],
    ]);
    expect(reading.violations[0]).toMatchObject({
      impact: "serious",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
    });
    expect(reading.violations[0]?.nodes[0]?.html).toBe('<p id="#site-faint">');
    expect(reading.passes[0]?.nodes.map((n) => n.target)).toEqual([["h1"], ["#site-plain"]]);
    // The gradient node stays an ordinary incomplete node, NOT part of the crash.
    expect(reading.incomplete[0]?.nodes.map((n) => n.target)).toEqual([["#site-gradient"]]);
    expect(reading.crashes).toEqual([
      {
        rule: "color-contrast",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
        message: 'Unable to parse color "oklch(0.205 0 none)" Skipping color-contrast rule.',
        nodes: [expect.objectContaining({ target: ["#xo-crash", "a"] })],
      },
    ]);
  });

  it("reports one crash per crash node, so each frame's crash is attributed on its own", () => {
    const reading = readAxeResults([
      {
        id: "color-contrast",
        error: { message: "first" },
        incomplete: [
          rawNode(["a.cta"], { none: [crashCheck("site threw")] }),
          rawNode(["#xo-crash", "a"], { none: [crashCheck("frame threw")] }),
        ],
      },
    ]);
    expect(reading.crashes.map((c) => [c.message, c.nodes[0]?.target])).toEqual([
      ["site threw", ["a.cta"]],
      ["frame threw", ["#xo-crash", "a"]],
    ]);
    expect(reading.incomplete).toEqual([]);
  });

  // "Cannot tell" is the site's: an error with no node to attribute fails.
  it("keeps a rule's error as a crash with no node when axe filed none", () => {
    expect(
      readAxeResults([{ id: "document-title", error: { message: "boom" }, incomplete: [] }])
        .crashes,
    ).toEqual([{ rule: "document-title", helpUrl: undefined, message: "boom", nodes: [] }]);
  });

  it("reads anything that is not axe's raw array as an empty report", () => {
    const empty = { violations: [], passes: [], incomplete: [], crashes: [] };
    expect(readAxeResults(undefined)).toEqual(empty);
    // The v1 report is an object, not the raw array: nothing is read from it,
    // so a spec that lost `reporter: "raw"` fails every live test instead of
    // quietly reading half a report.
    expect(readAxeResults({ violations: [], passes: [], incomplete: [] })).toEqual(empty);
  });
});

/** The spec a default site gets, captured as text. */
async function specOf(): Promise<string> {
  const cwd = await tmpSite();
  const sink = { spec: "" };
  await a11yAudit({
    site: { path: cwd },
    spawn: async (_cmd, args, opts) => {
      sink.spec = await readFile(args[args.length - 1] as string, "utf-8");
      const out = join(opts?.cwd ?? process.cwd(), ".reddoor-a11y");
      await mkdir(out, { recursive: true });
      await writeFile(
        join(out, "results.json"),
        JSON.stringify({ totalViolations: 0, byImpact: {} }),
      );
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return sink.spec;
}

/**
 * #100. a11y-live-spec.test.ts runs the generated spec in Chromium against ONE
 * fixture page and shows that the reveals planted there — plain, rootMargin,
 * Web Animations, a delayed two-stage intro, a page that grows, a bar that
 * depends on the scroll offset — are measured as a reader sees them. That is
 * evidence about those shapes, not about every reveal a site can write. This
 * pins where the call sits in the spec, which a browser run alone would not
 * name if it went wrong.
 */
describe("audits/a11y — the page is scrolled through before axe runs (#100)", () => {
  it("the generated spec runs the exported function, not a copy of it", async () => {
    expect(await specOf()).toContain(`const revealBelowFold = ${revealBelowFold.toString()};`);
  });

  it("scrolls after the transition-snapping sheet and before axe, on every scanned route", async () => {
    const spec = await specOf();
    const loopAt = spec.indexOf(
      "for (const { path, name, placeholder404Ok, sourceAbsent } of pages)",
    );
    const snapAt = spec.indexOf("await page.addStyleTag(", loopAt);
    const revealAt = spec.indexOf("await page.evaluate(revealBelowFold);", loopAt);
    const axeAt = spec.indexOf("new AxeBuilder({ page })", loopAt);
    expect(loopAt).toBeGreaterThan(-1);
    expect(snapAt).toBeGreaterThan(loopAt);
    // After the sheet, so each reveal snaps to its final state as it fires.
    expect(revealAt).toBeGreaterThan(snapAt);
    expect(axeAt).toBeGreaterThan(revealAt);
    // Once, in the axe loop — not in the hydration smoke, which runs no axe.
    expect(spec.split("page.evaluate(revealBelowFold)").length - 1).toBe(1);
  });
});

/**
 * #52. a11y-live-spec.test.ts shows that, on its fixture page with a CSP of
 * roalson-interests' shape, the generated spec's axe run posts no connect-src
 * report while a canary report does arrive. This pins the option and its
 * position in the chain.
 */
describe("audits/a11y — axe runs without its CSSOM preload (#52)", () => {
  const axeChain = (spec: string): string => {
    const start = spec.indexOf("new AxeBuilder({ page })");
    const end = spec.indexOf(".analyze()", start);
    // Not a soft fallback: a chain this cannot find would pass both checks below.
    if (start < 0 || end < 0) throw new Error("generated spec has no AxeBuilder chain");
    return spec.slice(start, end);
  };

  it("the axe config carries preload: false", async () => {
    // With the raw reporter beside it (#916 review); see axe-results.ts.
    expect(axeChain(await specOf())).toContain('.options({ preload: false, reporter: "raw" })');
  });

  // AxeBuilder.options() REPLACES the options object that withTags() writes
  // runOnly into. After withTags(), it would drop the WCAG filter silently.
  // Round-2 review: legacy mode skipped cross-origin frames but also dropped
  // frame-focusable-content, the site's own defect that axe evaluates inside
  // the frame. Default mode audits the frames; the spec drops their nodes
  // afterwards and keeps that rule (held by a11y-live-spec.test.ts).
  it("stays in default mode, so rules that run inside a frame still run", async () => {
    expect(axeChain(await specOf())).not.toContain("setLegacyMode");
  });

  it("sets the options before the tags, so the tag filter survives", async () => {
    const chain = axeChain(await specOf());
    expect(chain.indexOf(".options(")).toBeGreaterThan(-1);
    expect(chain.indexOf(".withTags(")).toBeGreaterThan(chain.indexOf(".options("));
  });

  // The claim the spec's comment makes, as code: turning the preload off costs
  // the gate no violation it could have raised. A rule that reads preloaded
  // assets is harmless here only if these tags never run it, or if it can only
  // ever report `incomplete`. Read against the axe-core that
  // @axe-core/playwright resolves in THIS repo — a site's own install may
  // differ, and a new axe-core that adds a preload rule the gate would run
  // fails here and forces the decision to be made again.
  it("no rule the gate runs needs the preload to raise a violation", async () => {
    type AxeRule = { id: string; tags: string[]; preload?: boolean; reviewOnFail?: boolean };
    const fromAxePlaywright = createRequire(
      createRequire(import.meta.url).resolve("@axe-core/playwright"),
    );
    const axe = fromAxePlaywright("axe-core") as {
      _audit: { rules: AxeRule[]; tagExclude: string[] };
    };
    const tags = JSON.parse(
      axeChain(await specOf()).match(/\.withTags\((\[[^\]]*\])\)/)?.[1] ?? "null",
    ) as string[] | null;
    if (tags === null) throw new Error("generated spec has no withTags([...]) call");

    // axe's own tag matching: run when any tag matches, unless the rule carries
    // a default-excluded tag ("experimental", "deprecated") the gate did not ask for.
    const excluded = axe._audit.tagExclude.filter((t) => !tags.includes(t));
    const runs = (rule: AxeRule) =>
      rule.tags.some((t) => tags.includes(t)) && !rule.tags.some((t) => excluded.includes(t));

    const preloading = axe._audit.rules.filter((r) => r.preload === true);
    // Not vacuous: axe-core 4.13 has two such rules. If this ever reads zero,
    // the property below is being checked over nothing.
    expect(preloading.length).toBeGreaterThan(0);
    expect(preloading.filter((r) => runs(r) && r.reviewOnFail !== true).map((r) => r.id)).toEqual(
      [],
    );
  });
});

/**
 * #100 review: the reveal pass's own report used to be discarded. It is now in
 * the artifact, and a pass that stopped short warns by name.
 */
describe("audits/a11y — the reveal pass is recorded, and an incomplete one warns (#100)", () => {
  const pass = (route: string, over: Partial<RevealRecord> = {}): RevealRecord => ({
    route,
    steps: 12,
    stepPx: 360,
    capped: false,
    scrollHeight: 4000,
    finalScrollY: 0,
    unsettled: 0,
    ...over,
  });
  const clean = [pass("a11y fixtures"), pass("animate-in demo")];

  it("is empty when every pass finished cleanly", () => {
    expect(describeReveals(clean)).toBe("");
    expect(describeReveals([])).toBe("");
  });

  it("names each way a pass can stop short, per route", () => {
    expect(describeReveals([pass("/", { capped: true, steps: 400 })])).toBe(
      "reveal pass incomplete on 1 route: / (stopped at the step cap (400 steps) before the bottom)",
    );
    expect(describeReveals([pass("/a", { unsettled: 2 }), pass("/b", { finalScrollY: 120 })])).toBe(
      "reveal pass incomplete on 2 routes: /a (2 animations still running after 5 s), /b (left at scrollY 120, not the top)",
    );
    expect(describeReveals([pass("/", { unsettled: 1, finalScrollY: 5 })])).toBe(
      "reveal pass incomplete on 1 route: / (1 animation still running after 5 s; left at scrollY 5, not the top)",
    );
  });

  it("warns — not passes — when a pass stopped short, and says where", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn({
        totalViolations: 0,
        byImpact: {},
        reveals: [pass("a11y fixtures", { unsettled: 1 }), pass("animate-in demo")],
      }),
    });
    expect(result.status).toBe("warn");
    expect(result.summary).toContain(
      "reveal pass incomplete on 1 route: a11y fixtures (1 animation still running after 5 s)",
    );
  });

  it("never turns a fail into anything else, and still names the pass", async () => {
    const cwd = await tmpSite();
    const result = await a11yAudit({
      site: { path: cwd },
      spawn: playwrightSpawn(
        {
          totalViolations: 1,
          byImpact: { serious: 1 },
          violations: [{ id: "color-contrast", impact: "serious", route: "a11y fixtures" }],
          reveals: [pass("a11y fixtures", { capped: true, steps: 400 })],
        },
        1,
      ),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("reveal pass incomplete on 1 route: a11y fixtures");
  });

  it("leaves a clean run's summary byte-for-byte what it was without the field", async () => {
    const withReveals = await a11yAudit({
      site: { path: await tmpSite() },
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {}, reveals: clean }),
    });
    const without = await a11yAudit({
      site: { path: await tmpSite() },
      spawn: playwrightSpawn({ totalViolations: 0, byImpact: {} }),
    });
    expect(withReveals.status).toBe("pass");
    expect(withReveals.summary).toBe(without.summary);
  });

  it("the generated spec records every scanned route's pass in the artifact", async () => {
    const spec = await specOf();
    expect(spec).toContain("pass = await page.evaluate(revealBelowFold);");
    expect(spec).toContain("reveals.push({ route: name, ...pass });");
    // The artifact write carries it, beside skipped.
    const artifactWrite = spec.slice(spec.indexOf("totalViolations: violations.length"));
    expect(artifactWrite).toMatch(
      /^totalViolations: violations\.length,\s+byImpact,\s+violations,\s+skipped,\s+reveals,/,
    );
  });
});

/**
 * #100 review, rounds 2 and 3: cross-origin frame contents are audited
 * (default mode) and then not counted — but only on positive evidence. The
 * spec walks each nested node's frame path and asks every frame for the URL it
 * actually loaded (a11y-live-spec.test.ts holds that walk against redirects,
 * wrapper frames, shadow roots and a srcdoc facade). What the filter then
 * keeps and drops, as a table — this is the function the spec runs.
 */
describe("audits/a11y — nodes inside cross-origin frames are counted, not failed", () => {
  const XO = "#xo";
  const path = (...frames: unknown[]) => JSON.stringify(frames);
  const v = (id: string, ...targets: unknown[][]) => ({
    id,
    nodes: targets.map((target) => ({ target })),
  });

  it("drops a node only when its whole frame path was found foreign, and keeps everything else", () => {
    const split = splitCrossOriginFrameNodes(
      [
        v("image-alt", [XO, "img"], ["#own", "img"], ["img.top"], ["#own", "iframe", "img"]),
        v("color-contrast", [XO, "p"]),
        v("frame-title", [XO]),
      ],
      [path(XO), path("#own", "iframe")],
    );
    expect(split.kept).toEqual([
      // A same-origin frame's node and a top-document node stay.
      v("image-alt", ["#own", "img"], ["img.top"]),
      // The <iframe> element itself is a top-document node (length 1) and stays.
      v("frame-title", [XO]),
    ]);
    // A violation left with no nodes is gone, and every dropped node is counted.
    expect(split.dropped).toBe(3);
    expect(split.rules).toEqual(["image-alt", "color-contrast"]);
  });

  it("keeps every frame-focusable-content node — the site's defect, seen from inside the frame", () => {
    const split = splitCrossOriginFrameNodes(
      [v("frame-focusable-content", [XO, "html"])],
      [path(XO)],
    );
    expect(split.kept).toEqual([v("frame-focusable-content", [XO, "html"])]);
    expect(split.dropped).toBe(0);
  });

  it("matches a shadow-root frame by its whole selector array", () => {
    const shadow = v("image-alt", [["#host", "iframe"], "img"]);
    expect(splitCrossOriginFrameNodes([shadow], [path(["#host", "iframe"])]).dropped).toBe(1);
    expect(splitCrossOriginFrameNodes([shadow], [path("#host")]).kept).toEqual([shadow]);
  });

  it("calls a document foreign only when it is http(s) on another origin", () => {
    const TOP = "http://localhost:5173";
    expect(isForeignUrl("https://www.youtube.com/embed/x", TOP)).toBe(true);
    expect(isForeignUrl("http://127.0.0.1:5173/x", TOP)).toBe(true);
    expect(isForeignUrl("http://localhost:5173/own", TOP)).toBe(false);
    // A srcdoc facade, a script-filled blank frame, data: and blob: documents
    // hold the site's markup; an unparsable URL is "cannot tell".
    expect(isForeignUrl("about:srcdoc", TOP)).toBe(false);
    expect(isForeignUrl("about:blank", TOP)).toBe(false);
    expect(isForeignUrl("data:text/html,<p>x</p>", TOP)).toBe(false);
    expect(isForeignUrl("blob:http://localhost:5173/abc", TOP)).toBe(false);
    expect(isForeignUrl("not a url", TOP)).toBe(false);
  });

  it("the generated spec runs these exact functions, not copies of them", async () => {
    const spec = await specOf();
    for (const fn of [isForeignUrl, resolveTargetElement, splitCrossOriginFrameNodes]) {
      expect(spec).toContain(`const ${fn.name} = ${fn.toString()};`);
    }
    expect(spec).toContain(
      "frameNodesDropped.push({ route: name, count: split.dropped, rules: split.rules });",
    );
    // The decision is made from the URL each frame actually loaded, by the
    // walker (held below with fake frames).
    expect(spec).toContain("frameOnPathIsForeign(");
  });

  it("names dropped nodes in the summary as information: empty when there are none", () => {
    expect(describeFrameNodesDropped([])).toBe("");
    expect(describeFrameNodesDropped([{ route: "/", count: 0, rules: [] }])).toBe("");
    expect(
      describeFrameNodesDropped([
        { route: "/", count: 2, rules: ["image-alt", "link-name"] },
        { route: "/about", count: 0, rules: [] },
        { route: "/contact", count: 1, rules: ["image-alt"] },
      ]),
    ).toBe(
      "3 violation nodes inside cross-origin frames not counted: / (2: image-alt, link-name), /contact (1: image-alt)",
    );
  });

  it("never changes the status: a clean run with dropped nodes still passes, and says so", async () => {
    const result = await a11yAudit({
      site: { path: await tmpSite() },
      spawn: playwrightSpawn({
        totalViolations: 0,
        byImpact: {},
        frameNodesDropped: [{ route: "a11y fixtures", count: 1, rules: ["image-alt"] }],
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toContain(
      "; 1 violation node inside cross-origin frames not counted: a11y fixtures (1: image-alt)",
    );
  });
});

/**
 * #100 review, rounds 2 and 3: an error thrown inside a third-party iframe
 * reaches `pageerror` too, and the reveal pass is what loads lazy embeds. An
 * error is the third party's ONLY on positive evidence — a cross-origin
 * frame's own error log recorded it. Where the stack starts is never
 * evidence: a site crashing inside a library it loaded from a CDN has a stack
 * that starts on the CDN, and it is still the site's crash.
 */
describe("audits/a11y — an error is a cross-origin frame's only on that frame's own evidence", () => {
  const TOP = { url: "http://localhost:5173/", foreign: false };
  const EMBED = { url: "https://embed.example.com/widget", foreign: true };
  const err = (message: string) => ({ message, route: "/" });

  it("moves an error a cross-origin frame's log recorded, and names that frame", () => {
    const split = splitThirdPartyErrors(
      [err("embed broke"), err("site broke")],
      [
        { ...TOP, messages: ["site broke"] },
        { ...EMBED, messages: ["embed broke"] },
      ],
    );
    expect(split.site).toEqual([err("site broke")]);
    expect(split.thirdParty).toEqual([{ ...err("embed broke"), frame: EMBED.url }]);
  });

  it("keeps an error no cross-origin frame recorded — whatever its stack says", () => {
    // The library case: the site's own frame logged it (or logged it hidden),
    // no embed did. Nothing in this function reads a stack.
    const split = splitThirdPartyErrors(
      [err("lib.render was given no element")],
      [
        { ...TOP, messages: ["lib.render was given no element"] },
        { ...EMBED, messages: [] },
      ],
    );
    expect(split.site).toEqual([err("lib.render was given no element")]);
    expect(split.thirdParty).toEqual([]);
  });

  it("with the same message on both sides, counts the site's first", () => {
    const split = splitThirdPartyErrors(
      [err("boom"), err("boom"), err("boom")],
      [
        { ...TOP, messages: ["boom", "boom"] },
        { ...EMBED, messages: ["boom", "boom"] },
      ],
    );
    expect(split.site).toHaveLength(2);
    expect(split.thirdParty).toHaveLength(1);
  });

  it("moves nothing when a site frame logged a hidden error, which could be any of them", () => {
    const split = splitThirdPartyErrors(
      [err("embed broke")],
      [
        { ...TOP, messages: [null] },
        { ...EMBED, messages: ["embed broke"] },
      ],
    );
    expect(split.site).toEqual([err("embed broke")]);
    expect(split.thirdParty).toEqual([]);
  });

  it("does not match a cross-origin frame's hidden error to anything", () => {
    const split = splitThirdPartyErrors(
      [err("maps broke")],
      [
        { ...TOP, messages: [] },
        { ...EMBED, messages: [null] },
      ],
    );
    expect(split.site).toEqual([err("maps broke")]);
  });

  it("records the stack's first URL for the reader, reading only `at` lines", () => {
    expect(firstStackUrl("Error: x\n    at http://127.0.0.1:9/lib.js:1:20")).toBe(
      "http://127.0.0.1:9/lib.js:1:20",
    );
    expect(
      firstStackUrl(
        "Error: failed https://cdn.example/x\n    at <anonymous>:1:5\n    at f (http://localhost:5173/app.js:3:1)",
      ),
    ).toBe("http://localhost:5173/app.js:3:1");
    expect(firstStackUrl("Error: x\n    at <anonymous>:1:1")).toBeNull();
    expect(firstStackUrl("")).toBeNull();
  });

  it("the generated spec runs these exact functions, and never classifies by stack", async () => {
    const spec = await specOf();
    for (const fn of [recordFrameErrors, splitThirdPartyErrors, firstStackUrl]) {
      expect(spec).toContain(`const ${fn.name} = ${fn.toString()};`);
    }
    expect(spec).toContain("await page.addInitScript(recordFrameErrors);");
    expect(spec).toContain("const split = splitThirdPartyErrors(errors, frameLogs);");
  });

  it("names third-party errors by route and origin, folding repeats", () => {
    expect(describeThirdPartyErrors([])).toBe("");
    expect(
      describeThirdPartyErrors([
        { route: "/", frame: "https://www.youtube.com/embed/a", source: null, message: "a" },
        { route: "/", frame: "https://www.youtube.com/embed/b", source: null, message: "b" },
        { route: "/contact", source: "https://cdn.example/x.js:1:1", message: "c" },
      ]),
    ).toBe(
      "3 uncaught errors thrown inside cross-origin frames, not counted: / (https://www.youtube.com ×2), /contact (unknown origin)",
    );
  });

  it("warns — never fails — on third-party errors alone, and says where", async () => {
    const result = await a11yAudit({
      site: { path: await tmpSite() },
      spawn: playwrightSpawn({
        totalViolations: 0,
        byImpact: {},
        thirdPartyErrors: [
          {
            route: "/",
            frame: "https://maps.example.com/embed",
            source: "https://maps.example.com/x.js:1:1",
            message: "boom",
          },
        ],
      }),
    });
    expect(result.status).toBe("warn");
    expect(result.summary).toContain(
      "1 uncaught error thrown inside cross-origin frames, not counted: / (https://maps.example.com)",
    );
  });
});

/**
 * #100 review, round 4: the two frame-walking steps of the spec, lifted into
 * functions so their safe directions can be held with fake frames. Every read
 * is bounded, and every "cannot tell" stays the site's.
 */
describe("audits/a11y — frame reads are bounded, and unreadable is the site's", () => {
  const TOP = "http://localhost:5173";
  const NEVER = () => new Promise<never>(() => undefined);
  // These tests hold time limits, so an unbounded regression must fail them
  // fast, not at the suite's 120 s test timeout.
  const FAST = 5_000;
  const logFrame = (url: string, read: () => Promise<unknown>) => ({
    url: () => url,
    evaluate: read,
  });

  it(
    "skips a frame with no document, and never waits on one",
    async () => {
      const main = logFrame(`${TOP}/`, async () => ["site broke"]);
      const unloaded = logFrame("", NEVER);
      const started = Date.now();
      const logs = await collectFrameErrorLogs([main, unloaded], main, TOP, isForeignUrl, 60_000);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(logs).toEqual([{ url: `${TOP}/`, foreign: false, messages: ["site broke"] }]);
    },
    FAST,
  );

  it(
    "gives up on a frame that does not answer: no evidence from a cross-origin one, a hidden entry for the site's",
    async () => {
      const main = logFrame(`${TOP}/`, NEVER);
      const embed = logFrame("https://embed.example.com/w", NEVER);
      const answering = logFrame("https://other.example.com/x", async () => ["embed broke"]);
      const logs = await collectFrameErrorLogs(
        [main, embed, answering],
        main,
        TOP,
        isForeignUrl,
        50,
      );
      expect(logs).toEqual([
        { url: `${TOP}/`, foreign: false, messages: [null] },
        { url: "https://other.example.com/x", foreign: true, messages: ["embed broke"] },
      ]);
    },
    FAST,
  );

  it(
    "treats a read that throws like one that does not answer",
    async () => {
      const main = logFrame(`${TOP}/`, async () => {
        throw new Error("detached");
      });
      const embed = logFrame("https://embed.example.com/w", async () => {
        throw new Error("detached");
      });
      expect(await collectFrameErrorLogs([main, embed], main, TOP, isForeignUrl, 50)).toEqual([
        { url: `${TOP}/`, foreign: false, messages: [null] },
      ]);
    },
    FAST,
  );

  type Walkable = Parameters<typeof frameOnPathIsForeign>[0];
  const walkFrame = (url: string, children: Record<string, Walkable | null> = {}): Walkable => ({
    url: () => url,
    evaluateHandle: async (_fn, selector) => {
      const key = JSON.stringify(selector);
      if (!(key in children)) return { asElement: () => null };
      const child = children[key] ?? null;
      return { asElement: () => ({ contentFrame: async () => child }) };
    },
  });
  const walk = (main: Walkable, path: Array<string | string[]>, timeoutMs = 1000) =>
    frameOnPathIsForeign(main, path, TOP, isForeignUrl, resolveTargetElement, timeoutMs);

  it("finds a foreign document through same-origin wrappers and shadow selectors", async () => {
    const embed = walkFrame("https://embed.example.com/x");
    const wrapper = walkFrame(`${TOP}/wrapper`, { [JSON.stringify("iframe")]: embed });
    const main = walkFrame(`${TOP}/`, {
      [JSON.stringify("#wrap")]: wrapper,
      [JSON.stringify(["#host", "iframe"])]: embed,
    });
    expect(await walk(main, ["#wrap", "iframe"])).toBe(true);
    expect(await walk(main, [["#host", "iframe"]])).toBe(true);
    expect(await walk(main, ["#wrap"])).toBe(false);
  });

  it("calls a srcdoc facade the site's", async () => {
    const main = walkFrame(`${TOP}/`, { [JSON.stringify("#facade")]: walkFrame("about:srcdoc") });
    expect(await walk(main, ["#facade"])).toBe(false);
  });

  it(
    "keeps anything unresolvable the site's: no element, no frame, a throw, or no answer",
    async () => {
      const main = walkFrame(`${TOP}/`, { [JSON.stringify("#gone")]: null });
      // The selector no longer resolves (a frame removed before the walk).
      expect(await walk(main, ["#missing"])).toBe(false);
      // It resolves, but to something with no frame.
      expect(await walk(main, ["#gone"])).toBe(false);
      const throwing: Walkable = {
        url: () => `${TOP}/`,
        evaluateHandle: async () => {
          throw new Error("Frame was detached");
        },
      };
      expect(await walk(throwing, ["#x"])).toBe(false);
      const silent: Walkable = { url: () => `${TOP}/`, evaluateHandle: NEVER };
      const started = Date.now();
      expect(await walk(silent, ["#x"], 50)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    },
    FAST,
  );

  it("the generated spec runs these exact functions and passes FRAME_READ_TIMEOUT_MS at both call sites", async () => {
    const spec = await specOf();
    for (const fn of [collectFrameErrorLogs, frameOnPathIsForeign]) {
      expect(spec).toContain(`const ${fn.name} = ${fn.toString()};`);
    }
    expect(spec).toContain("const FRAME_READ_TIMEOUT_MS = 2000;");
    // The limit is only as good as the calls that pass it: the settle's log
    // read, and the frame-path walk.
    expect(spec).toMatch(
      /collectFrameErrorLogs\(\s*page\.frames\(\),\s*page\.mainFrame\(\),\s*currentOrigin,\s*isForeignUrl,\s*FRAME_READ_TIMEOUT_MS,?\s*\)/,
    );
    expect(spec).toMatch(
      /frameOnPathIsForeign\(\s*page\.mainFrame\(\),\s*path,\s*currentOrigin,\s*isForeignUrl,\s*resolveTargetElement,\s*FRAME_READ_TIMEOUT_MS,?\s*\)/,
    );
  });

  it("bounds every navigation to about:blank, and never lets one throw", async () => {
    const spec = await specOf();
    const navigations = spec.match(/page\.goto\("about:blank"[^\n]*/g) ?? [];
    // One per axe route and one per smoke route.
    expect(navigations).toHaveLength(2);
    for (const line of navigations) {
      expect(line).toBe(
        'page.goto("about:blank", { timeout: ABOUT_BLANK_TIMEOUT_MS }).catch(() => {});',
      );
    }
    expect(spec).toContain("const ABOUT_BLANK_TIMEOUT_MS = 10_000;");
  });

  it("settles once more after the smoke loop: nothing held is ever dropped", async () => {
    const spec = await specOf();
    const smokeStart = spec.indexOf("for (const { path, name } of smokePages)");
    const loopEnd = spec.indexOf("\n  }\n", smokeStart);
    const byImpact = spec.indexOf("const byImpact = {};");
    expect(smokeStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(smokeStart);
    expect(spec.slice(loopEnd, byImpact)).toContain("await settleErrors();");
  });
});
