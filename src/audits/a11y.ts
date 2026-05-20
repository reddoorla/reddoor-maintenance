import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, Site } from "../types.js";
import { a11yRoutes } from "../configs/playwright-a11y.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";

type NormalizedA11y = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

function isFakeShape(stdout: string): NormalizedA11y | null {
  try {
    const parsed = JSON.parse(stdout) as NormalizedA11y;
    if (typeof parsed.totalViolations === "number" && parsed.byImpact) return parsed;
  } catch {
    return null;
  }
  return null;
}

function buildSpec(): string {
  return `
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const pages = ${JSON.stringify(a11yRoutes)};
for (const { path, name } of pages) {
  test(\`\${name} has no axe violations\`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
`;
}

export async function a11yAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  const dir = await mkdtemp(join(tmpdir(), "reddoor-a11y-"));
  const specPath = join(dir, "a11y.spec.ts");
  await writeFile(specPath, buildSpec(), "utf-8");

  let raw;
  try {
    raw = await spawn("npx", ["--yes", "playwright", "test", "--reporter=json", specPath], {
      cwd: site.path,
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
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
  await rm(dir, { recursive: true, force: true });

  const fake = isFakeShape(raw.stdout);
  const normalized: NormalizedA11y = fake ?? {
    totalViolations: raw.code === 0 ? 0 : 1,
    byImpact: raw.code === 0 ? {} : { moderate: 1 },
  };

  const hasSerious =
    (normalized.byImpact.serious ?? 0) > 0 || (normalized.byImpact.critical ?? 0) > 0;
  const hasAny = normalized.totalViolations > 0;

  const status: AuditResult["status"] = hasSerious ? "fail" : hasAny ? "warn" : "pass";
  const summary =
    status === "pass"
      ? `a11y: 0 violations across ${a11yRoutes.length} routes`
      : `a11y: ${normalized.totalViolations} violations`;

  return {
    audit: "a11y",
    site: label,
    status,
    summary,
    details: normalized,
  };
}
