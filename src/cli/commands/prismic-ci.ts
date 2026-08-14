// The fleet face of the `prismic-ci` recipe: land the Prismic model delivery
// workflow across the fleet, as ONE PULL REQUEST PER REPOSITORY.
//
// The blast radius is fifteen live client repositories, and the failure this
// file is written against is not a bad PR — the recipe's gates handle that, and
// nothing here can push to a client's main. It is the QUIET one: a run that
// touched nothing and exited 0, read as a finished rollout. Three facts only the
// fleet layer can get wrong produce it, and each has a refusal below:
//
//   - an inventory that resolved NOBODY prints "0 applied, 0 noop, 0 failed."
//     and exits 0, which is indistinguishable from a fleet with nothing left to
//     do. The Airtable inventory is view-filtered; one filter change empties it
//     with no error anywhere.
//   - a site that could not be PREPARED is isolated into `skipped` by
//     `prepareFleetSites` (correctly — one bad row must not abort the fleet) and
//     then disappears from a summary built out of `prepared` alone. It gets a
//     `failed` ROW, because the count is the only thing a machine reads.
//   - a checkout holding `.git` and nothing else answers "not a Prismic site" to
//     every read inside it, so the site noops out of the rollout for good — a
//     fleet workdir reuses any non-empty directory forever. Guarded BEFORE the
//     recipe runs: a tree nobody established is not a tree to branch from.
//
// SEQUENTIAL, one site at a time, like every other fleet recipe command — see
// `runRecipeOverSites`. Each site does git work in its own checkout plus a
// handful of GitHub calls; there is no Airtable write on this path (so the
// fleet's ≤4.5 req/s throttle does not apply) and nothing parallelism would buy
// except a burst of writes against fifteen repositories at once.
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { prismicCi } from "../../recipes/prismic-ci/index.js";
import { REUSABLE_WORKFLOW_PIN, isPinResolved } from "../../recipes/prismic-ci/template.js";
import type { RecipeResult, Site } from "../../types.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { siteLabel } from "../../util/site.js";
import { noWorkingTreeFailure } from "../../util/working-tree.js";
import { appendSkipNotice, prepareFleetSites, type SkippedSite } from "../fleet/prepare-sites.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";

export type PrismicCiCommandOptions = {
  fleet?: string;
  workdir?: string;
  dry?: boolean;
  cwd?: string;
};

/** Injected only by tests, so the fleet layer's aggregation — counts, exit code,
 *  refusals — is exercised without git, GitHub or a network. Production runs the
 *  real recipe. */
export type PrismicCiCommandDeps = {
  runRecipe?: (site: Site) => Promise<RecipeResult>;
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const failedRow = (site: string, notes: string): RecipeResult => ({
  recipe: "prismic-ci",
  site,
  status: "failed",
  commits: [],
  notes,
});

/**
 * One line per site plus a counts summary — the shape every fleet rollout
 * prints, so a sweep over fifteen repos is scannable.
 *
 * The banner above the counts is not decoration. A rollout in which every site
 * failed prints fifteen `[site] failed:` lines and then an arithmetic exercise;
 * the one fact an operator needs from that run — NOT ONE repository got the
 * workflow — has to be stated. It is keyed on "sites were attempted and none was
 * applied", not on "nothing was applied": a fleet that is already fully
 * delivered applies nothing every time it runs, and a banner that shouts at that
 * run is a banner nobody reads at the run above.
 */
export function formatPrismicCiResults(results: RecipeResult[]): string {
  const lines = results.map((r) => `[${r.site}] ${r.status}: ${r.notes ?? ""}`.trimEnd());
  const n = (s: RecipeResult["status"]) => results.filter((r) => r.status === s).length;
  const failed = n("failed");
  lines.push("");
  if (failed > 0 && n("applied") === 0) {
    lines.push(
      `⛔ NO SITE GOT THE DELIVERY WORKFLOW. ${failed} of ${results.length} site(s) failed and` +
        ` not one pull request was opened, so no site's model changes reach Prismic on merge.` +
        ` Do NOT read this run as a rollout.`,
    );
    lines.push("");
  }
  lines.push(`${n("applied")} applied, ${n("noop")} noop, ${failed} failed.`);
  return lines.join("\n");
}

/**
 * Is there a checkout here at all, or the named reason there is not?
 *
 * Runs BEFORE the recipe, for both the reason in {@link noWorkingTreeFailure}
 * and one this command adds: the recipe's next steps create a branch, write a
 * file and commit it. A directory nobody managed to check out is not a tree to
 * do that in, and the answer the recipe would otherwise reach — "not a Prismic
 * site" — is the one answer that quietly removes the site from the rollout.
 *
 * A `readdir` that THROWS is its own failure and never the skip: a path that
 * does not exist, or one this process cannot read, is not a repo without
 * Prismic in it.
 */
async function checkoutFailure(repoRoot: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(repoRoot);
  } catch (e) {
    return `cannot read this checkout at ${repoRoot}: ${messageOf(e)}`;
  }
  return noWorkingTreeFailure(
    repoRoot,
    entries,
    "No delivery workflow was proposed for it and no pull request was opened",
  );
}

/**
 * Roll the delivery workflow out to one site or to the fleet.
 *
 * `resolveSites` is allowed to THROW (a positional site alongside `--fleet`, an
 * unsupported inventory extension, an Airtable read that failed). Those are "the
 * fleet itself could not be established", which has no per-site row to live in
 * and must not be reported as a rollout across zero sites; `bin.ts` prints the
 * message and exits with the error's own `exitCode`.
 */
export async function runPrismicCiCommand(
  site: string | undefined,
  opts: PrismicCiCommandOptions,
  deps: PrismicCiCommandDeps = {},
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    // Passed through because `--fleet airtable` derives each site's path from
    // it; without it the keyword inventory would resolve paths under a different
    // workdir than the one this run then prepares and commits in.
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  // NOTHING RESOLVED IS NOT A DELIVERED FLEET — the refusal `runFleetSweep` and
  // the token doctor both open with, for the same reason: the summary below
  // would print "0 applied, 0 noop, 0 failed." over no rows at all and exit 0,
  // which is exactly what a finished rollout looks like.
  if (sites.length === 0) {
    return {
      output:
        `the inventory resolved NO SITES, so no site was offered the delivery workflow.` +
        ` This is not a delivered fleet — check the inventory (an Airtable view filter, an` +
        ` empty JSON file, a dynamic inventory returning []). Do NOT read this exit as a` +
        ` rollout.`,
      code: 1,
    };
  }

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const prep = await prepareFleetSites(sites, { workdir: opts.workdir ?? fleetWorkdir() });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  // THE PIN, checked here as well as in the recipe — not a second copy of the
  // gate but the same exported predicate on the same exported pin, asked at the
  // one point the recipe cannot answer for: a `--dry` run never reaches the
  // recipe at all, and a preview that promised fifteen pull requests the real
  // run would refuse is a preview of something that cannot happen.
  const pinUnresolved = !isPinResolved(REUSABLE_WORKFLOW_PIN)
    ? `⛔ the reusable-workflow pin is unresolved (${REUSABLE_WORKFLOW_PIN.sha}) — every site` +
      ` below would be REFUSED, not delivered. Publish and tag the workflow in` +
      ` reddoorla/.github, then set REUSABLE_WORKFLOW_PIN.`
    : "";

  if (opts.dry) {
    const lines = sites.map(
      (s) =>
        `[${siteLabel(s)}] would be offered the delivery workflow (no gate was evaluated:` +
        ` the secret, default-branch and already-delivered checks run only on a real run)`,
    );
    return {
      output: appendSkipNotice(
        [pinUnresolved, lines.join("\n")].filter((s) => s !== "").join("\n\n"),
        skipped,
      ),
      code: pinUnresolved === "" ? 0 : 1,
    };
  }

  const run = deps.runRecipe ?? ((s: Site) => prismicCi(s));
  const results = await runRecipeOverSites("prismic-ci", sites, async (s) => {
    const failure = await checkoutFailure(s.path);
    return failure ? failedRow(siteLabel(s), failure) : run(s);
  });

  // A SITE THAT COULD NOT BE PREPARED IS A SITE THAT DID NOT GET THE WORKFLOW,
  // and it gets a row. `prepareFleetSites` isolates the clone failure into
  // `skipped`, which is right and is also exactly how a site disappears: a
  // summary walking `prepared` alone counts a fleet-wide clone outage — an
  // expired App token, GitHub down, a full disk — as "0 applied, 0 failed",
  // exit 0. The notice below stays; the row is what makes the site countable.
  for (const s of skipped) {
    results.push(
      failedRow(
        s.site,
        `could not prepare this checkout: ${s.reason}. No delivery workflow was proposed` +
          ` for it — this is NOT "this site already has one".`,
      ),
    );
  }

  return {
    output: appendSkipNotice(formatPrismicCiResults(results), skipped),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
