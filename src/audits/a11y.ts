import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, Site } from "../types.js";
import { a11yRoutes } from "../configs/playwright-a11y.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";

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

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

async function readJsonMaybe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

  const specDir = await mkdtemp(join(tmpdir(), "reddoor-a11y-spec-"));
  const specPath = join(specDir, "a11y.spec.ts");
  await writeFile(specPath, buildSpec(), "utf-8");

  const resultsPath = join(site.path, RESULTS_REL);
  // Clear stale artifacts so a failed spawn never reports old data.
  await rm(join(site.path, ".reddoor-a11y"), { recursive: true, force: true });

  let raw;
  try {
    raw = await spawn("npx", ["--yes", "playwright", "test", "--reporter=line", specPath], {
      cwd: site.path,
      env: { ...process.env, REDDOOR_A11Y_OUTPUT: resultsPath },
    });
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
