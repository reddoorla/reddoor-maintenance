import { resolve } from "node:path";
import { matchHarness } from "../../recipes/match-harness/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type MatchHarnessCommandOptions = {
  ref?: string;
  cand?: string;
  /** cac type-coerces a numeric option value, so this arrives as a NUMBER for
   *  `--matrix 1440` and a string only when it contains a comma or a letter. */
  matrix?: string | number;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runMatchHarnessCommand(
  site: string | undefined,
  opts: MatchHarnessCommandOptions,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  // A bad --matrix must not silently become [NaN]: the matrix is the gate's
  // denominator, and a NaN viewport would produce a score nobody could read.
  //
  // Two things force the shape below. cac COERCES a numeric option value, so
  // `--matrix 1440` arrives as the number 1440 (`.split` would throw) and
  // `--matrix 0` as the number 0 — which is FALSY, so a truthiness test drops it
  // and the recipe silently applies the default [1440,834,390] and exits 0. So:
  // normalise to a string, and branch on PRESENCE, never on truthiness.
  const rawMatrix = opts.matrix === undefined ? undefined : String(opts.matrix);
  const matrix =
    rawMatrix === undefined ? undefined : rawMatrix.split(",").map((v) => Number(v.trim()));
  if (matrix !== undefined && matrix.some((v) => !Number.isFinite(v) || v <= 0)) {
    return {
      output: `match-harness: --matrix "${rawMatrix}" is not a list of viewports`,
      code: 1,
    };
  }

  const results = await runRecipeOverSites("match-harness", sites, (s) =>
    matchHarness(s, {
      ref: opts.ref ?? "",
      ...(opts.cand !== undefined ? { cand: opts.cand } : {}),
      ...(matrix !== undefined ? { matrix } : {}),
    }),
  );

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
