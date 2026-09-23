import { resolve } from "node:path";
import { analyticsTag } from "../../recipes/analytics-tag/index.js";
import { MEASUREMENT_ID_RE } from "../../recipes/analytics-tag/template.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";

export type AnalyticsTagCommandOptions = {
  measurementId?: string;
  productionHost?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

/**
 * Deliberately ONE SITE AT A TIME, with no `--fleet` mode.
 *
 * Every site needs its own GA4 web-stream, so there is no fleet-wide value to
 * pass: a single `--measurement-id` applied across the fleet would point twenty
 * sites at one property, and the resulting data is not separable afterwards.
 * The numeric property ID on the Websites row is a DIFFERENT value and cannot
 * stand in for it.
 */
export async function runAnalyticsTagCommand(
  site: string | undefined,
  opts: AnalyticsTagCommandOptions,
): Promise<{ output: string; code: number }> {
  const measurementId = opts.measurementId?.trim() ?? "";
  if (!MEASUREMENT_ID_RE.test(measurementId)) {
    return {
      output:
        `--measurement-id must be a GA4 web-stream ID (G- plus 10 characters); got ` +
        `${JSON.stringify(opts.measurementId ?? "")}. That is not the numeric property ID on the ` +
        `site's Websites row — the two are different values and only one ships in the page.`,
      code: 2,
    };
  }

  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const sites = await resolveSites({ ...(site !== undefined ? { site } : {}), cwd });
  if (sites.length !== 1) {
    return {
      output:
        `analytics-tag takes exactly one site (resolved ${sites.length}). Each site needs its own ` +
        "GA4 stream, so there is no fleet-wide measurement ID to sweep with.",
      code: 2,
    };
  }

  const results: RecipeResult[] = [
    await analyticsTag(sites[0]!, {
      measurementId,
      ...(opts.productionHost !== undefined ? { productionHost: opts.productionHost } : {}),
    }),
  ];

  return {
    output: results.map(formatResult).join("\n"),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
