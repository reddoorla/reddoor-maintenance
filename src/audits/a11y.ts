import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { a11yRoutes } from "../configs/playwright-a11y.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { findFreePort } from "../util/free-port.js";

type Impact = "minor" | "moderate" | "serious" | "critical";

type AxeViolation = {
  id: string;
  impact: Impact;
  route: string;
  help?: string;
  helpUrl?: string;
  nodes?: Array<{ html?: string; target?: string[] }>;
};

type NormalizedA11y = {
  totalViolations: number;
  byImpact: Partial<Record<Impact, number>>;
  violations: AxeViolation[];
};

const RESULTS_REL = ".reddoor-a11y/results.json";

async function readJsonMaybe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// The audit-controlled playwright config. We synthesize it (rather than
// rely on the site's playwright.config.ts) so we can pin the dev server
// port + force `--strictPort` — same fix as the lighthouse audit, same
// reason (zombie vite processes squatting on 5173 would otherwise eat
// the audit's request and return stale 404s).
function buildPlaywrightConfig(port: number, sitePath: string): string {
  return `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\\.spec\\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:${port}",
    trace: "on-first-retry",
  },
  webServer: {
    // --strictPort: refuse to bump to a different port if ours is taken,
    //   so the audit fails loudly instead of probing a zombie.
    // reuseExistingServer:false: never reuse — we control the lifecycle.
    // cwd: playwright's default webServer.cwd is the config file's
    //   directory. Our config lives in /tmp so without this override,
    //   "npm run vite:dev" tries to read /tmp/.../package.json and
    //   ENOENTs before vite ever starts. Caltex 2026-05-28 (0.10.5).
    command: "npm run vite:dev -- --port ${port} --strictPort",
    url: "http://localhost:${port}/dev/a11y-fixtures",
    cwd: ${JSON.stringify(sitePath)},
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
`;
}

// The spec the audit writes runs all configured routes through axe in a single
// test (so worker isolation doesn't fragment the collected violations) and
// writes the structured result to <cwd>/.reddoor-a11y/results.json before
// asserting. That way, the audit can read real axe details even when the
// expect(...).toEqual([]) assertion fails.
function buildSpec(): string {
  return `import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const pages = ${JSON.stringify(a11yRoutes)};
const OUTPUT = process.env.REDDOOR_A11Y_OUTPUT;

// Playwright's default per-test timeout is 30s. We loop through every
// configured route in a single test, so the budget needs to scale.
test.setTimeout(5 * 60_000);

test("a11y across configured routes", async ({ page }) => {
  const violations = [];
  for (const { path, name } of pages) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])
      .analyze();
    for (const v of results.violations) {
      violations.push({
        id: v.id,
        impact: v.impact ?? "moderate",
        route: name,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({ html: n.html, target: n.target })),
      });
    }
  }
  const byImpact = {};
  for (const v of violations) {
    byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
  }
  if (OUTPUT) {
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(
      OUTPUT,
      JSON.stringify({ totalViolations: violations.length, byImpact, violations }, null, 2),
    );
  }
  expect(violations).toEqual([]);
});
`;
}

export async function a11yAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  // specDir lives INSIDE site.path (not /tmp) so the spec's
  // `import AxeBuilder from "@axe-core/playwright"` resolves via Node's
  // walk-up — the site's node_modules is the nearest one. A spec written
  // to /tmp ENOENTs at module resolution before any test runs. Caltex
  // 2026-05-28 (0.10.6 dogfood), third layer of the same class as the
  // webServer.cwd bug.
  const specDir = await mkdtemp(join(site.path, ".reddoor-a11y-spec-"));
  const specPath = join(specDir, "a11y.spec.ts");
  await writeFile(specPath, buildSpec(), "utf-8");

  const port = await findFreePort();
  const configPath = join(specDir, "playwright.config.ts");
  await writeFile(configPath, buildPlaywrightConfig(port, site.path), "utf-8");

  const resultsPath = join(site.path, RESULTS_REL);
  // Clear stale artifacts so a failed spawn never reports old data.
  await rm(join(site.path, ".reddoor-a11y"), { recursive: true, force: true });

  let raw;
  try {
    raw = await spawn(
      "npx",
      ["--yes", "playwright", "test", `--config=${configPath}`, "--reporter=line", specPath],
      {
        cwd: site.path,
        env: { ...process.env, REDDOOR_A11Y_OUTPUT: resultsPath },
        // playwright on a cold tree downloads Chrome, boots the site's dev
        // server, and runs axe over every configured route. The shared 30 s
        // default in runAudits is fine for deps/lint/security but starves
        // playwright (mirrors the lighthouse fix shipped earlier).
        timeoutMs: 5 * 60_000,
      },
    );
  } catch (err) {
    await rm(specDir, { recursive: true, force: true });
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return {
        audit: "a11y",
        site: label,
        status: "skip",
        summary: "npx/playwright not available",
      };
    }
    throw err;
  }
  await rm(specDir, { recursive: true, force: true });

  const artifact = await readJsonMaybe<NormalizedA11y>(resultsPath);

  if (!artifact) {
    return {
      audit: "a11y",
      site: label,
      status: "fail",
      summary: `a11y: no results written (exit ${raw.code})${
        raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
      }`,
    };
  }

  const hasSerious = (artifact.byImpact.serious ?? 0) > 0 || (artifact.byImpact.critical ?? 0) > 0;
  const hasAny = artifact.totalViolations > 0;

  const status: AuditResult["status"] = hasSerious ? "fail" : hasAny ? "warn" : "pass";
  const summary =
    status === "pass"
      ? `a11y: 0 violations across ${a11yRoutes.length} routes`
      : `a11y: ${artifact.totalViolations} violations`;

  return {
    audit: "a11y",
    site: label,
    status,
    summary,
    details: artifact,
  };
}
