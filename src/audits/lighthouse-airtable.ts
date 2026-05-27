import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { LighthouseScores } from "../reports/types.js";
import { siteSlug } from "../reports/airtable/websites.js";

/**
 * Extract the four Lighthouse scores (as integer percentages) from a
 * `lighthouse` AuditResult. LHCI manifest summaries are floats in [0,1];
 * multiply + round.
 */
export function lighthouseScoresFromResult(result: AuditResult): LighthouseScores {
  if (result.audit !== "lighthouse") {
    throw new Error(`Expected a 'lighthouse' AuditResult, got '${result.audit}'`);
  }
  const details = (result.details ?? {}) as { summary?: Record<string, number> };
  const summary = details.summary ?? {};
  const toPct = (n: number | undefined) =>
    typeof n === "number" && !Number.isNaN(n) ? Math.round(n * 100) : 0;
  return {
    performance: toPct(summary["performance"]),
    accessibility: toPct(summary["accessibility"]),
    bestPractices: toPct(summary["best-practices"]),
    seo: toPct(summary["seo"]),
  };
}

/**
 * Derive a site slug from the cwd's package.json#name. Used by
 * `audit lighthouse --write-airtable` when the operator doesn't pass an
 * explicit slug — the cwd is the site checkout, so package.json#name is
 * usually the canonical site name.
 */
export async function resolveSlugFromCwd(cwd: string): Promise<string> {
  try {
    const pkgPath = join(cwd, "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { name?: string };
    if (!pkg.name) throw new Error("package.json has no 'name' field");
    return siteSlug(pkg.name);
  } catch (e) {
    throw new Error(
      `Could not derive site slug from ${cwd}/package.json: ${(e as Error).message}. ` +
        `Pass --write-airtable=<slug> explicitly.`,
      { cause: e },
    );
  }
}
