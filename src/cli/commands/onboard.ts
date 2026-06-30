import { resolve } from "node:path";
import { onboard, type OnboardAudit } from "../../recipes/onboard.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type OnboardCommandOptions = {
  fleet?: string;
  workdir?: string;
  cwd?: string;
  audits?: string;
};

const ALL_AUDITS: OnboardAudit[] = ["lighthouse", "a11y"];

function parseAudits(value: string | undefined): OnboardAudit[] | undefined {
  if (!value) return undefined;
  const parsed = value.split(",").map((s) => s.trim());
  for (const a of parsed) {
    if (!ALL_AUDITS.includes(a as OnboardAudit)) {
      throw Object.assign(
        new Error(`unknown audit in --audits: ${a}. expected ${ALL_AUDITS.join(", ")}`),
        { exitCode: 2 },
      );
    }
  }
  return parsed as OnboardAudit[];
}

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runOnboardCommand(
  site: string | undefined,
  opts: OnboardCommandOptions,
): Promise<{ output: string; code: number }> {
  const audits = parseAudits(opts.audits);
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  const results = await runRecipeOverSites("onboard", sites, (s) =>
    onboard(s, audits ? { audits } : {}),
  );

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
