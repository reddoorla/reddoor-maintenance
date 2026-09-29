import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  syncConfigs,
  ALL_CONFIG_NAMES,
  isConfigName,
  planTemplateDiffs,
  planGitignore,
} from "../../recipes/sync-configs.js";
import { ALL_TEMPLATES, templatesByName } from "../../recipes/sync-configs/templates.js";
import { isGitWorkTree } from "../../util/git.js";
import type { ConfigName, RecipeResult, Site } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type SyncConfigsCommandOptions = {
  only?: string;
  dry?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function parseOnly(value?: string): ConfigName[] | undefined {
  if (!value) return undefined;
  const names = value.split(",").map((s) => s.trim());
  for (const n of names) {
    if (!isConfigName(n)) {
      throw Object.assign(
        new Error(`unknown config in --only: "${n}". Valid: ${ALL_CONFIG_NAMES.join(", ")}`),
        { exitCode: 2 },
      );
    }
  }
  return names as ConfigName[];
}

type DryChange = { path: string; text: string };

async function dryPlanGitignore(cwd: string, requireGit: boolean): Promise<DryChange | null> {
  const isRepo = await isGitWorkTree(cwd);
  if (!isRepo && requireGit) throw new Error(`not a git work tree: ${cwd}`);
  const plan = await planGitignore(cwd, isRepo ? undefined : []);
  if (plan.kind === "noop") return null;
  const parts: string[] = [];
  if (plan.added.length > 0) parts.push(`${plan.added.length} canonical entries to add`);
  if (plan.toUntrack.length > 0) {
    parts.push(`${plan.toUntrack.length} tracked file(s) to untrack: ${plan.toUntrack.join(", ")}`);
  }
  const exists = await readFile(join(cwd, ".gitignore"), "utf-8").then(
    () => true,
    () => false,
  );
  const verb = exists ? "would update .gitignore" : "would create .gitignore";
  return { path: ".gitignore", text: parts.length > 0 ? `${verb} (${parts.join("; ")})` : verb };
}

async function dryPlan(
  cwd: string,
  which: ConfigName[] | undefined,
  requireGit: boolean,
): Promise<DryChange[]> {
  const includeGitignore = which ? which.includes("gitignore") : true;
  const templateTargets = which
    ? templatesByName(which.filter((c): c is ConfigName => c !== "gitignore"))
    : ALL_TEMPLATES;

  // Ask the recipe's own planner rather than re-deriving drift here. svelte.config
  // and netlify.toml are compliance-checked, not byte-matched, so a local
  // `existing !== contents` comparison reported files the real run leaves alone —
  // and a preview that disagrees with the command it previews is worse than none.
  const diffs = await planTemplateDiffs(cwd, templateTargets);
  const changes = diffs.map((t) => ({
    path: t.path,
    text: `would update ${t.path} (config: ${t.config})`,
  }));
  if (includeGitignore) {
    const gi = await dryPlanGitignore(cwd, requireGit);
    if (gi) changes.push(gi);
  }
  return changes;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

async function runDry(
  sites: Site[],
  skipped: SkippedSite[],
  which: ConfigName[] | undefined,
  requireGit: boolean,
): Promise<string> {
  const blocks: string[] = [];
  const lines: string[] = [];
  let drifted = 0;
  let clean = 0;
  let failed = 0;
  for (const s of sites) {
    const repo = s.gitRepo || s.name || s.path;
    let changes: DryChange[];
    try {
      changes = await dryPlan(s.path, which, requireGit);
    } catch (e) {
      const reason = `dry plan failed: ${oneLine((e as Error).message)}`;
      blocks.push(`[${s.name || s.path}]\n${reason}`);
      lines.push(`SKIPPED ${repo} ${reason}`);
      failed++;
      continue;
    }
    const text = changes.length === 0 ? "no changes needed" : changes.map((c) => c.text).join("\n");
    blocks.push(`[${s.name || s.path}]\n${text}`);
    if (changes.length === 0) {
      lines.push(`CLEAN ${repo}`);
      clean++;
    } else {
      for (const c of changes) lines.push(`DRIFT ${repo} ${c.path}`);
      drifted++;
    }
  }
  for (const k of skipped) lines.push(`SKIPPED ${k.repo ?? k.site} ${oneLine(k.reason)}`);
  const skippedCount = failed + skipped.length;
  lines.push(
    `SYNC_CONFIGS_DRIFT drifted=${drifted} clean=${clean} skipped=${skippedCount} ` +
      `total=${drifted + clean + skippedCount}`,
  );
  return `${appendSkipNotice(blocks.join("\n\n"), skipped)}\n\n${lines.join("\n")}`;
}

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? "all configs in sync"}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runSyncConfigsCommand(
  site: string | undefined,
  opts: SyncConfigsCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);
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

  if (opts.dry) {
    return { output: await runDry(sites, skipped, which, Boolean(opts.fleet)), code: 0 };
  }

  const results = await runRecipeOverSites("sync-configs", sites, (s) =>
    syncConfigs(s, which ? { which } : {}),
  );

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
