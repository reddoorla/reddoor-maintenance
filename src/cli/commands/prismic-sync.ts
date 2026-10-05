// The D1 pull-sync (operator decision, 2026-10-01; identity 2026-10-04): an edit
// made in Prismic's Type Builder lands in Prismic first, and this brings it back
// to the repo as ONE reviewed pull request per site, so the repo stays the
// source of truth.
//
// Two modes:
//
//   - `prismic-sync [site]` writes Prismic's copy of every changed and every
//     remote-only model into ONE working tree, for a human to review and commit.
//   - `prismic-sync --fleet <inventory>` clones each site fresh and syncs it.
//     Alone it is a dry run that reports what each PR would hold. The nightly
//     runs it as three jobs (`--stage fetch`, scripts/prismic-sync-build.mjs,
//     `--stage publish --open-prs`), described at the fleet section below, and
//     the last commits to the fixed branch `prismic-sync` and opens or updates
//     one PR against the default branch.
//
// What it never does: write to Prismic, delete a file, force-push, or merge.
// The model writes are `refreshChangedModel` and `writeModelFile`, the two
// capabilities in src/prismic/models/write.ts, each with its own guards. A model
// that exists only in the repo is listed in the PR body and left alone.
//
// DIRECTION IS AMBIGUOUS, AND THE PR SAYS SO. A difference means either "Prismic
// was edited" (merge the PR) or "the repo's last apply failed" (close it: merging
// would revert the repo). Only a human can tell, so the PR is never auto-merged
// and its body names every changed model with the drift report's own lines.
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { makeSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { isOwnerRepo } from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import type { Site } from "../../types.js";
import { PRETTIER_FLAG_NOTE } from "../../recipes/_prettier.js";
import {
  defaultDeps as defaultModelDeps,
  syncSiteModels,
  type PrismicModelsDeps,
  type SiteSync,
  type SyncedModel,
} from "./prismic-models.js";

/** The one branch the sync ever pushes. Fixed, so a second night updates the
 *  first night's PR instead of opening another. */
export const SYNC_BRANCH = "prismic-sync";

/** Marks a PR body as this command's, so a reader knows where it came from. */
export const SYNC_MARKER = "<!-- reddoor-maint:prismic-sync -->";

/** Names the model content a sync PR carries, in its body, so a decline is
 *  kept for as long as Prismic offers that same content, whatever else the
 *  default branch gains meanwhile. */
const MODELS_KEY = /<!-- reddoor-maint:prismic-sync-models (sha256:[0-9a-f]{64}) -->/;
const modelsKeyLine = (key: string): string => `<!-- reddoor-maint:prismic-sync-models ${key} -->`;

export const modelsKeyOf = (body: string | null | undefined): string | null =>
  MODELS_KEY.exec(body ?? "")?.[1] ?? null;

/** A body the sync itself closed no longer names its content, so the close
 *  is never read later as a human's decline of it. */
export const withoutModelsKey = (body: string): string =>
  body.replace(new RegExp(`${MODELS_KEY.source}\n?`, "g"), "");

/** The `reddoor-renovate` App's bot user, the identity the operator chose on
 *  2026-10-04. 312185038 is its user id, as in renovate.yml. */
export const SYNC_AUTHOR = {
  name: "reddoor-renovate[bot]",
  email: "312185038+reddoor-renovate[bot]@users.noreply.github.com",
};

export type PrismicSyncOptions = {
  fleet?: string;
  workdir?: string;
  openPrs?: boolean;
  cwd?: string;
  /** Fleet mode in the nightly's three jobs: `fetch`, then `publish`. */
  stage?: string;
  /** fetch: where the plan and each site's build input go. */
  out?: string;
  /** publish: the fetch stage's `--out`. */
  plan?: string;
  /** publish: one directory per built site, named by its id. */
  built?: string;
};

export type OpenPr = { number: number; url: string };

/** The four pull-request calls the sync makes, and nothing else. */
export type SyncGitHub = {
  findOpenPr: (repo: string, head: string, base: string) => Promise<OpenPr | null>;
  createPr: (
    repo: string,
    pr: { head: string; base: string; title: string; body: string },
  ) => Promise<OpenPr>;
  updatePr: (repo: string, number: number, pr: { title: string; body: string }) => Promise<void>;
  closePr: (repo: string, number: number, comment: string) => Promise<void>;
  /** An archived repo clones and fetches like any other and refuses only the
   *  push, after all the work (CLAUDE.md, fleet sweeps). Asked first. */
  isArchived: (repo: string) => Promise<boolean>;
  /** Closed and NOT merged sync PRs, with the body each was closed with. */
  closedUnmergedPrs: (
    repo: string,
    head: string,
    base: string,
  ) => Promise<Array<OpenPr & { body: string }>>;
};

export type GitResult = { code: number; stdout: string; stderr: string };

export type PrismicSyncDeps = {
  models: PrismicModelsDeps;
  resolveSites: (fleet: string, workdir: string, cwd: string) => Promise<Site[]>;
  git: (args: readonly string[], cwd: string, env?: Record<string, string>) => Promise<GitResult>;
  /** Built late, and only by the fleet mode, so a missing token fails there. */
  github: () => SyncGitHub;
  cloneUrl: (repo: string) => string;
  /** Removes anything secret from text that may reach a log. */
  redact: (text: string) => string;
  /** Tars a clone's working tree, without `.git` and without following links. */
  archive: (root: string, tarFile: string) => Promise<void>;
};

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type Synced = Extract<SiteSync, { ok: true }>;

const written = (r: Synced): SyncedModel[] => [...r.changed, ...r.adopted];

export const syncPrTitle = (repositoryName: string): string =>
  `chore(prismic): sync models from Prismic (${repositoryName})`;

/** One `describeDiff` line, reworded for a pull. Its own suffixes are written
 *  for a push ("pushing DELETES it", "(new)"), which in a pull PR would say
 *  the opposite of what the PR does. */
export function forPull(line: string): string {
  const PUSH_DELETE = " (only in Prismic — pushing DELETES it)";
  if (line.startsWith("- ")) {
    return `${line.endsWith(PUSH_DELETE) ? line.slice(0, -PUSH_DELETE.length) : line} (only in Prismic: this PR adds it)`;
  }
  if (line.startsWith("+ ")) {
    return `${line.replace(/ \(new\)$/, "")} (only in the repo: this PR removes it)`;
  }
  return line;
}

/** The PR body. Every changed model is named with `describeDiff`'s lines. */
export function renderSyncPrBody(
  r: Synced,
  notes: { regenerated: boolean | "not-migrated"; unformatted: boolean; modelsKey: string },
): string {
  const out: string[] = [
    SYNC_MARKER,
    modelsKeyLine(notes.modelsKey),
    `Prismic repository **${r.repositoryName}** holds models this repo does not match. This PR`,
    `brings Prismic's copy into the repo. It is opened by the nightly pull-sync and is never`,
    `merged automatically.`,
    "",
    "> **Check the direction before merging.** A difference means one of two things:",
    "> - **Prismic was edited** (the Type Builder, a dashboard edit): merge this PR.",
    "> - **The repo is ahead** (its last `prismic-models` apply failed or has not run):",
    ">   close this PR. Merging it would revert the repo's change.",
    "",
  ];
  if (r.changed.length > 0) {
    out.push(`### Changed models (${r.changed.length})`, "");
    out.push(
      "The lines are the drift report's, written from the repo's side: `+` is in the repo",
      "and not in Prismic, `-` is in Prismic and not in the repo, `~` differs (this PR takes",
      "Prismic's value). Each line says what this PR does with it.",
      "",
    );
    for (const m of r.changed) {
      out.push(`- \`${m.kind} ${m.id}\` → \`${m.path}\``);
      if (m.lines.length === 0) out.push("  - (no field-level line; the bodies differ)");
      for (const l of m.lines) out.push(`  - \`${forPull(l)}\``);
    }
    out.push("");
  }
  if (r.adopted.length > 0) {
    out.push(`### Models only in Prismic, adopted (${r.adopted.length})`, "");
    for (const m of r.adopted) out.push(`- \`${m.kind} ${m.id}\` → \`${m.path}\` (new file)`);
    out.push("");
  }
  if (r.localOnly.length > 0) {
    out.push(`### Models only in the repo, left alone (${r.localOnly.length})`, "");
    for (const m of r.localOnly) out.push(`- \`${m.kind} ${m.id}\` (\`${m.path}\`)`);
    out.push(
      "",
      "The sync has no delete path. These reach Prismic the usual way, on merge to `main`.",
      "",
    );
  }
  out.push("### Generated files", "");
  if (notes.regenerated === "not-migrated") {
    out.push(
      "This site still runs Slice Machine (no `prismic.config.json`), so the generated types",
      "were **not** regenerated. Regenerate them before merging.",
    );
  } else {
    out.push("Regenerated with the site's own `prismic gen types` and `prismic gen slice-index`.");
  }
  if (notes.unformatted) out.push("", `⚠ ${PRETTIER_FLAG_NOTE}`);
  out.push(
    "",
    "Each night this branch is rebuilt from the default branch and Prismic as they are then,",
    "as a new commit on top (never a force-push). When the two agree again, the PR is closed.",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Single site, one working tree
// ---------------------------------------------------------------------------

function renderLocal(r: SiteSync): { output: string; code: number } {
  if (!r.ok) return { output: r.failure.output, code: r.failure.code };
  const lines = [`Prismic sync — repository: ${r.repositoryName}`, ""];
  for (const m of r.changed) {
    lines.push(`refreshed ${m.kind} ${m.id}  -> ${m.path}${m.formatted ? "" : "  (unformatted)"}`);
    for (const l of m.lines) lines.push(`    ${l}`);
  }
  for (const m of r.adopted) {
    lines.push(`adopted   ${m.kind} ${m.id}  -> ${m.path}${m.formatted ? "" : "  (unformatted)"}`);
  }
  for (const m of r.localOnly) lines.push(`left      ${m.kind} ${m.id}  (only in the repo)`);
  for (const x of r.refused) lines.push(`REFUSED   ${x.kind} ${x.id}  — ${x.reason}`);
  if (written(r).some((m) => !m.formatted)) lines.push(`⚠ ${PRETTIER_FLAG_NOTE}`);
  lines.push("");
  const n = written(r).length;
  lines.push(
    n === 0 && r.refused.length === 0
      ? "in sync — nothing written."
      : `${n} model(s) written${r.refused.length > 0 ? `, ${r.refused.length} refused` : ""}.` +
          (n > 0 ? " Review, commit, and open a PR." : ""),
  );
  return { output: lines.join("\n"), code: r.refused.length > 0 ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Fleet: three stages, so no process that runs a site's code shares a job
// with a credential (operator decision 72, answered (a) on 2026-10-05).
//
//   fetch    Prismic tokens and a read-only GitHub token. Clones each site,
//            writes Prismic's models into the clone (no process may run), and
//            leaves a plan plus one tarball per site that needs building.
//   build    scripts/prismic-sync-build.mjs, inside `docker run --rm`, in a
//            job with no secret: the site's install, prettier and codegen.
//   publish  The write token. Runs no site code: it builds each commit itself
//            from the default branch's tree and the named files, and takes a
//            formatted model only when it still equals Prismic's.
// ---------------------------------------------------------------------------

export type SiteOutcome =
  | "in-sync"
  | "closed"
  | "opened"
  | "updated"
  | "unchanged"
  | "would-open"
  | "held"
  | "declined"
  | "skipped"
  | "failed";

type SiteReport = { label: string; outcome: SiteOutcome; detail: string };

type SyncView = Pick<Synced, "repositoryName" | "changed" | "adopted" | "localOnly">;

/** One site's line in the plan the fetch stage hands to the other two. */
export type SitePlan =
  | { label: string; outcome: "skipped" | "failed"; detail: string }
  | {
      label: string;
      outcome: "in-sync";
      detail: string;
      repo: string;
      base: string;
      repositoryName: string;
      localOnly: number;
    }
  | {
      label: string;
      outcome: "build";
      id: string;
      repo: string;
      base: string;
      baseHead: string;
      sync: SyncView;
      models: Array<{ path: string; raw: string }>;
      generated: string[];
      libraries: string[];
      modelsKey: string;
      migrated: boolean;
    };

export type SyncPlan = { version: 1; sites: SitePlan[] };

/** What the build stage leaves for one site, read back by publish. */
type BuildResult = { ok: boolean; formatted: boolean; error: string | null };

const MAX_BUILT_BYTES = 5 * 1024 * 1024;

const SAFE_SEGMENT = /^[A-Za-z0-9._@-]+$/;

/** A plain relative path: no `..`, no absolute, no odd characters. */
function safeRelative(path: string): boolean {
  if (path === "" || path.startsWith("/")) return false;
  return path.split("/").every((s) => SAFE_SEGMENT.test(s) && s !== "." && s !== "..");
}

/** The library directories, normalized the way the generated index is named. */
function libraryDirs(libraries: string[]): string[] {
  return libraries
    .map((lib) => posix.normalize(lib.replace(/^\.\//, "")).replace(/\/+$/, ""))
    .filter(safeRelative);
}

/** Files codegen may write: the types file and each library's index. */
function generatedPaths(libraries: string[]): string[] {
  return [
    "prismicio-types.d.ts",
    ...libraryDirs(libraries).flatMap((d) => [`${d}/index.ts`, `${d}/index.js`]),
  ];
}

/** A path only the sync writes: a model file, or a generated file. */
function isSyncPath(path: string, libraries: string[]): boolean {
  if (generatedPaths(libraries).includes(path)) return true;
  if (/^customtypes\/[^/]+\/index\.json$/.test(path)) return true;
  return libraryDirs(libraries).some((d) => {
    const rest = path.startsWith(`${d}/`) ? path.slice(d.length + 1) : null;
    return rest !== null && /^[^/]+\/model\.json$/.test(rest);
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function mustGit(
  deps: PrismicSyncDeps,
  args: readonly string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  const r = await deps.git(args, cwd, env);
  if (r.code !== 0) {
    throw new Error(deps.redact(`git ${args[0]} failed (${r.code}): ${r.stderr.trim()}`));
  }
  return r.stdout;
}

/** The spawner the fleet's model writes get: none. */
const refuseSpawn: SpawnFn = async (cmd) => {
  throw new Error(`no process may run during a fleet sync's model writes (asked for ${cmd})`);
};

/** sha256 over the written model files, each named by its path. */
function modelsContentKey(models: Array<{ path: string; raw: string }>): string {
  const hash = createHash("sha256");
  for (const m of [...models].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(`${m.path}\0`);
    hash.update(m.raw);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** The configured slice libraries, read the way the sync's own reads did. */
async function readLibraries(root: string): Promise<string[]> {
  const { readPrismicConfig } = await import("../../prismic/models/index.js");
  return (await readPrismicConfig(root))?.libraries ?? [];
}

// --- fetch -----------------------------------------------------------------

async function fetchOneSite(
  site: Site,
  index: number,
  deps: PrismicSyncDeps,
  opts: { workdir: string; outDir: string; github: SyncGitHub | null },
): Promise<SitePlan> {
  const label = siteLabel(site);
  const repo = site.gitRepo?.trim() ?? "";
  if (!isOwnerRepo(repo)) {
    return { label, outcome: "skipped", detail: "no owner/repo on this site's row" };
  }
  if (opts.github && (await opts.github.isArchived(repo))) {
    return { label, outcome: "skipped", detail: `${repo} is archived on GitHub` };
  }

  const root = await mkdtemp(join(opts.workdir, `${repo.replace("/", "--")}-`));
  await mustGit(deps, ["clone", "--no-tags", "--quiet", deps.cloneUrl(repo), root], opts.workdir);
  const base = (await mustGit(deps, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root))
    .trim()
    .replace(/^origin\//, "");
  const baseHead = (await mustGit(deps, ["rev-parse", `origin/${base}`], root)).trim();

  // No process may run during the model writes. They format with the clone's
  // own `node_modules/.bin/prettier` when one exists, and a repo can commit
  // one: it would run here, beside this job's tokens. Formatting happens in
  // the build stage, which holds none.
  const r = await syncSiteModels(
    root,
    { ...deps.models, spawn: refuseSpawn },
    { allowGenericToken: false },
  );
  if (!r.ok) {
    return {
      label,
      outcome: r.failure.status === "skipped" ? "skipped" : "failed",
      detail: deps.redact(r.failure.output),
    };
  }
  if (r.refused.length > 0) {
    return {
      label,
      outcome: "failed",
      detail:
        `${r.refused.length} model(s) refused, so nothing was committed: ` +
        r.refused.map((x) => `${x.kind} ${x.id} — ${x.reason}`).join("; "),
    };
  }
  const written = [...r.changed, ...r.adopted];
  if (written.length === 0) {
    return {
      label,
      outcome: "in-sync",
      detail: "in sync",
      repo,
      base,
      repositoryName: r.repositoryName,
      localOnly: r.localOnly.length,
    };
  }

  const models: Array<{ path: string; raw: string }> = [];
  for (const m of written) {
    if (!safeRelative(m.path)) throw new Error(`refusing an unusual model path ${m.path}`);
    models.push({ path: m.path, raw: await readFile(join(root, m.path), "utf-8") });
  }
  const libraries = await readLibraries(root);
  const migrated = await exists(join(root, "prismic.config.json"));
  const generated = migrated ? generatedPaths(libraries) : [];
  const id = `s${index}`;
  const siteDir = join(opts.outDir, "sites", id);
  await mkdir(siteDir, { recursive: true });
  await writeFile(
    join(siteDir, "spec.json"),
    JSON.stringify({ models: models.map((m) => m.path), generated, migrated }) + "\n",
    "utf-8",
  );
  await deps.archive(root, join(siteDir, "tree.tar"));
  return {
    label,
    outcome: "build",
    id,
    repo,
    base,
    baseHead,
    sync: {
      repositoryName: r.repositoryName,
      changed: r.changed,
      adopted: r.adopted,
      localOnly: r.localOnly,
    },
    models,
    generated,
    libraries,
    modelsKey: modelsContentKey(models),
    migrated,
  };
}

async function resolveFleet(
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
  cwd: string,
): Promise<{ sites: Site[]; workdir: string } | { output: string; code: number }> {
  const workdir = resolve(cwd, opts.workdir ?? fleetWorkdir());
  // Each site is cloned into a fresh temp directory under this one, never into
  // an existing checkout: a reused tree would sync a days-old default branch.
  await mkdir(workdir, { recursive: true });
  let sites: Site[];
  try {
    sites = await deps.resolveSites(opts.fleet ?? "", workdir, cwd);
  } catch (e) {
    return { output: `⛔ could not resolve the fleet: ${describe(e)}`, code: 1 };
  }
  if (sites.length === 0) {
    return {
      output: "⛔ the inventory resolved no sites, so this run established nothing.",
      code: 1,
    };
  }
  return { sites, workdir };
}

async function fetchPlan(
  sites: Site[],
  deps: PrismicSyncDeps,
  opts: { workdir: string; outDir: string; github: SyncGitHub | null },
): Promise<SyncPlan> {
  const plan: SyncPlan = { version: 1, sites: [] };
  for (const [i, site] of sites.entries()) {
    try {
      plan.sites.push(await fetchOneSite(site, i, deps, opts));
    } catch (e) {
      plan.sites.push({
        label: siteLabel(site),
        outcome: "failed",
        detail: deps.redact(describe(e)),
      });
    }
  }
  return plan;
}

const buildIds = (plan: SyncPlan): string[] =>
  plan.sites.flatMap((s) => (s.outcome === "build" ? [s.id] : []));

async function runFetchStage(
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
  cwd: string,
): Promise<{ output: string; code: number }> {
  if (!opts.out) return { output: "--stage fetch needs --out <dir>.", code: 2 };
  const fleet = await resolveFleet(opts, deps, cwd);
  if (!("sites" in fleet)) return fleet;
  let github: SyncGitHub;
  try {
    github = deps.github();
  } catch (e) {
    return { output: `⛔ cannot read GitHub: ${describe(e)}`, code: 1 };
  }
  const outDir = resolve(cwd, opts.out);
  await mkdir(outDir, { recursive: true });
  const plan = await fetchPlan(fleet.sites, deps, { workdir: fleet.workdir, outDir, github });
  await writeFile(join(outDir, "plan.json"), JSON.stringify(plan) + "\n", "utf-8");
  const ids = buildIds(plan);
  await writeFile(join(outDir, "matrix.json"), JSON.stringify(ids) + "\n", "utf-8");
  const lines = [`Prismic pull-sync, fetch — ${plan.sites.length} site(s)`, ""];
  for (const s of plan.sites) {
    const detail = s.outcome === "build" ? `to build as ${s.id}` : s.detail;
    lines.push(`${s.outcome.padEnd(10)} ${s.label} — ${detail.split("\n").join(" ")}`);
  }
  const count = (o: SitePlan["outcome"]): number =>
    plan.sites.filter((s) => s.outcome === o).length;
  lines.push(
    "",
    `PRISMIC_SYNC_FETCH sites=${plan.sites.length} build=${ids.length} in_sync=${count(
      "in-sync",
    )} skipped=${count("skipped")} failed=${count("failed")}`,
  );
  // A site that failed here is reported again by publish, which reds the run;
  // failing here would stop every other site's sync with it.
  return { output: lines.join("\n"), code: 0 };
}

// --- publish ---------------------------------------------------------------

/** Nothing left for the PR to bring in. Repo-only models may remain (the repo
 *  is ahead on those), so the comment does not claim the two agree. */
async function nothingToBring(
  github: SyncGitHub | null,
  site: { label: string; repo: string; base: string; repositoryName: string; localOnly: number },
  why: string,
): Promise<SiteReport> {
  const open = github ? await github.findOpenPr(site.repo, SYNC_BRANCH, site.base) : null;
  if (open && github) {
    await github.closePr(
      site.repo,
      open.number,
      `${SYNC_MARKER}\nPrismic repository **${site.repositoryName}** holds nothing tonight that the ` +
        `repo's \`${site.base}\` lacks, so this sync PR has nothing left to bring in` +
        (site.localOnly > 0
          ? ` (${site.localOnly} model(s) exist only in the repo; they reach Prismic on merge).`
          : ".") +
        ` Closed by the nightly pull-sync.`,
    );
    return { label: site.label, outcome: "closed", detail: `${why}; closed ${open.url}` };
  }
  return { label: site.label, outcome: "in-sync", detail: why };
}

/** Is `parents` a merge of the default branch into the sync branch that git
 *  itself would have produced (GitHub's "Update branch")? Its second parent is
 *  on the default branch, and its tree is the clean merge of the two, so a
 *  conflict resolved by hand or an edit folded into the merge does not pass. */
async function isDefaultBranchMerge(
  deps: PrismicSyncDeps,
  root: string,
  ids: string[],
  baseHead: string,
): Promise<boolean> {
  const [commit, first, second, ...rest] = ids;
  if (!commit || !first || !second || rest.length > 0) return false;
  const onBase = await deps.git(["merge-base", "--is-ancestor", second, baseHead], root);
  if (onBase.code !== 0) return false;
  const merged = await deps.git(["merge-tree", "--write-tree", first, second], root);
  if (merged.code !== 0) return false;
  const tree = (await mustGit(deps, ["rev-parse", `${commit}^{tree}`], root)).trim();
  return merged.stdout.split("\n")[0]?.trim() === tree;
}

/** GitHub commits as this address when it rewrites a commit for a user. */
const GITHUB_COMMITTER = "noreply@github.com";

/** Is this one of the sync's own commits that GitHub re-committed ("Update
 *  with rebase")? The author is still the sync, GitHub is the committer, it is
 *  not a merge, and it touches nothing but the files the sync writes. */
async function isRebasedSyncCommit(
  deps: PrismicSyncDeps,
  root: string,
  ids: string[],
  author: string,
  committer: string,
  libraries: string[],
): Promise<boolean> {
  const [commit, , ...more] = ids;
  if (!commit || ids.length !== 2 || more.length > 0) return false;
  if (author !== SYNC_AUTHOR.email || committer !== GITHUB_COMMITTER) return false;
  const paths = (
    await mustGit(deps, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit], root)
  )
    .split("\0")
    .filter((p) => p !== "");
  return paths.length > 0 && paths.every((p) => isSyncPath(p, libraries));
}

/** The files publish will commit: each model as the build formatted it when it
 *  still holds exactly Prismic's content, else Prismic's own bytes; and the
 *  generated files the build produced. Only names the plan lists are read, and
 *  only as regular files. */
async function collectFiles(
  site: Extract<SitePlan, { outcome: "build" }>,
  builtDir: string,
  formattedByBuild: boolean,
): Promise<{ files: Array<{ path: string; bytes: Buffer }>; unformatted: boolean }> {
  const readRegular = async (rel: string): Promise<Buffer | null> => {
    if (!safeRelative(rel)) return null;
    const full = join(builtDir, "files", rel);
    const st = await lstat(full).catch(() => null);
    if (!st || !st.isFile() || st.size > MAX_BUILT_BYTES) return null;
    return readFile(full);
  };
  const files: Array<{ path: string; bytes: Buffer }> = [];
  let unformatted = !formattedByBuild;
  for (const m of site.models) {
    const built = await readRegular(m.path);
    let parsed: unknown;
    try {
      parsed = built ? JSON.parse(built.toString("utf-8")) : undefined;
    } catch {
      parsed = undefined;
    }
    if (built && parsed !== undefined && isDeepStrictEqual(parsed, JSON.parse(m.raw))) {
      files.push({ path: m.path, bytes: built });
    } else {
      files.push({ path: m.path, bytes: Buffer.from(m.raw, "utf-8") });
      unformatted = true;
    }
  }
  for (const rel of site.generated) {
    const built = await readRegular(rel);
    if (built) files.push({ path: rel, bytes: built });
  }
  return { files, unformatted };
}

/** The commit's tree: the default branch's, with exactly `files` written over
 *  it, built in a private index. Nothing is checked out, so nothing in the site
 *  repo (a filter, a hook, an attribute) has any say. */
async function buildTree(
  deps: PrismicSyncDeps,
  root: string,
  scratch: string,
  baseHead: string,
  files: Array<{ path: string; bytes: Buffer }>,
): Promise<string> {
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  await mustGit(deps, ["read-tree", baseHead], root, env);
  for (const [i, f] of files.entries()) {
    const blobFile = join(scratch, `blob-${i}`);
    await writeFile(blobFile, f.bytes);
    const blob = (
      await mustGit(deps, ["hash-object", "-w", "--no-filters", blobFile], root)
    ).trim();
    await mustGit(
      deps,
      ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`],
      root,
      env,
    );
  }
  return (await mustGit(deps, ["write-tree"], root, env)).trim();
}

async function publishOneSite(
  site: Extract<SitePlan, { outcome: "build" }>,
  builtDir: string,
  deps: PrismicSyncDeps,
  opts: { workdir: string; openPrs: boolean; github: SyncGitHub | null },
): Promise<SiteReport> {
  const { label, repo, base, baseHead } = site;
  let result: BuildResult;
  try {
    result = JSON.parse(await readFile(join(builtDir, "result.json"), "utf-8")) as BuildResult;
  } catch {
    return { label, outcome: "failed", detail: "the build stage left no result for this site" };
  }
  if (result.ok !== true) {
    return {
      label,
      outcome: "failed",
      detail: `the site's install or tools failed in the build stage: ${String(result.error ?? "no reason given").slice(-500)}`,
    };
  }
  const { files, unformatted } = await collectFiles(site, builtDir, result.formatted === true);
  const r: Synced = { ok: true, refused: [], ...site.sync };
  const models = [...r.changed, ...r.adopted];
  const summary =
    `${r.changed.length} changed, ${r.adopted.length} adopted: ` +
    models.map((m) => `${m.kind} ${m.id}`).join(", ");
  const inSyncView = {
    label,
    repo,
    base,
    repositoryName: r.repositoryName,
    localOnly: r.localOnly.length,
  };

  if (!opts.openPrs || !opts.github) {
    return { label, outcome: "would-open", detail: `would push ${SYNC_BRANCH} with ${summary}` };
  }
  const github = opts.github;

  const root = await mkdtemp(join(opts.workdir, `${repo.replace("/", "--")}-publish-`));
  await mustGit(
    deps,
    ["clone", "--no-checkout", "--no-tags", "--quiet", deps.cloneUrl(repo), root],
    opts.workdir,
  );
  await mustGit(deps, ["cat-file", "-e", `${baseHead}^{commit}`], root);
  const branchRef = `refs/remotes/origin/${SYNC_BRANCH}`;
  // The full ref, matched exactly: `ls-remote origin prismic-sync` also matches
  // any `*/prismic-sync`, such as a human's `fix/prismic-sync`.
  const branchExists = (
    await mustGit(deps, ["ls-remote", "origin", `refs/heads/${SYNC_BRANCH}`], root)
  )
    .split("\n")
    .some((l) => l.split("\t")[1] === `refs/heads/${SYNC_BRANCH}`);
  const open = await github.findOpenPr(repo, SYNC_BRANCH, base);

  if (branchExists) {
    await mustGit(
      deps,
      ["fetch", "--quiet", "origin", `+refs/heads/${SYNC_BRANCH}:${branchRef}`],
      root,
    );
    // A commit on the branch that the sync did not make is a human's (a
    // regenerated types file, a reviewer's fixup). Rebuilding the branch from
    // tonight's result would drop it in a fast-forward nobody would notice, so
    // the branch is left alone until that PR is merged or the branch removed.
    // Two things GitHub does on a user's click are not a human's work: "Update
    // branch" (a clean merge of the default branch) and "Update with rebase"
    // (the sync's own commits, re-committed by GitHub).
    const authors: string[] = [];
    const log = await mustGit(
      deps,
      ["log", "--format=%H %P%x00%ae%x00%ce", `${baseHead}..${branchRef}`],
      root,
    );
    for (const line of log.split("\n").filter((l) => l !== "")) {
      const [idList = "", ae = "", ce = ""] = line.split("\0");
      const ids = idList.split(" ");
      const others = [ae, ce].filter((a) => a !== SYNC_AUTHOR.email);
      if (others.length === 0) continue;
      if (await isDefaultBranchMerge(deps, root, ids, baseHead)) continue;
      if (await isRebasedSyncCommit(deps, root, ids, ae, ce, site.libraries)) continue;
      authors.push(...others);
    }
    if (authors.length > 0) {
      return {
        label,
        outcome: "held",
        detail:
          `${SYNC_BRANCH} carries commits the sync did not make (${[...new Set(authors)].join(", ")}),` +
          ` so it was left untouched. ` +
          (open
            ? `Merge or close ${open.url} and remove the branch to resume.`
            : `No sync PR is open, so the branch outlived its PR: delete it to resume.`),
      };
    }
  }

  const scratch = await mkdtemp(join(opts.workdir, "publish-index-"));
  const tree = await buildTree(deps, root, scratch, baseHead, files);
  const baseTree = (await mustGit(deps, ["rev-parse", `${baseHead}^{tree}`], root)).trim();
  if (tree === baseTree) {
    return nothingToBring(github, inSyncView, "the models differ only in ways git does not see");
  }

  const title = syncPrTitle(r.repositoryName);
  const body = renderSyncPrBody(r, {
    regenerated: site.migrated ? true : "not-migrated",
    unformatted,
    modelsKey: site.modelsKey,
  });

  // A human closed a sync PR carrying exactly this model content: they judged
  // the direction (most likely "the repo is ahead"). Reopening the same change
  // every night, or after every unrelated commit to the default branch, would
  // only offer the wrong merge again, and so would pushing to its branch. A
  // different Prismic edit is different content, which gets a new PR.
  if (!open) {
    const declined = (await github.closedUnmergedPrs(repo, SYNC_BRANCH, base)).find(
      (p) => modelsKeyOf(p.body) === site.modelsKey,
    );
    if (declined) {
      return {
        label,
        outcome: "declined",
        detail: `${declined.url} was closed unmerged with these same models; not reopened — ${summary}`,
      };
    }
  }

  let pushed = false;
  const branchTree = branchExists
    ? (await mustGit(deps, ["rev-parse", `${branchRef}^{tree}`], root)).trim()
    : null;
  if (branchTree !== tree) {
    const parents: string[] = [];
    if (branchExists) {
      parents.push((await mustGit(deps, ["rev-parse", branchRef], root)).trim());
      const contained = await deps.git(["merge-base", "--is-ancestor", baseHead, branchRef], root);
      if (contained.code !== 0) parents.push(baseHead);
    } else {
      parents.push(baseHead);
    }
    const env = {
      GIT_AUTHOR_NAME: SYNC_AUTHOR.name,
      GIT_AUTHOR_EMAIL: SYNC_AUTHOR.email,
      GIT_COMMITTER_NAME: SYNC_AUTHOR.name,
      GIT_COMMITTER_EMAIL: SYNC_AUTHOR.email,
    };
    const commit = (
      await mustGit(
        deps,
        ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", `${title}\n\n${summary}`],
        root,
        env,
      )
    ).trim();
    await mustGit(deps, ["push", "--quiet", "origin", `${commit}:refs/heads/${SYNC_BRANCH}`], root);
    pushed = true;
  }

  if (open) {
    // Only when the branch moved: a human's edit to the title or body of a PR
    // whose content did not change is theirs to keep.
    if (pushed) await github.updatePr(repo, open.number, { title, body });
    return {
      label,
      outcome: pushed ? "updated" : "unchanged",
      detail: `${pushed ? "pushed and updated" : "already current"} ${open.url} — ${summary}`,
    };
  }
  const created = await github.createPr(repo, { head: SYNC_BRANCH, base, title, body });
  return { label, outcome: "opened", detail: `opened ${created.url} — ${summary}` };
}

async function publishPlan(
  plan: SyncPlan,
  builtRoot: string,
  deps: PrismicSyncDeps,
  opts: { workdir: string; openPrs: boolean; github: SyncGitHub | null },
): Promise<SiteReport[]> {
  const reports: SiteReport[] = [];
  for (const s of plan.sites) {
    try {
      if (s.outcome === "build") {
        reports.push(await publishOneSite(s, join(builtRoot, s.id), deps, opts));
      } else if (s.outcome === "in-sync") {
        reports.push(await nothingToBring(opts.openPrs ? opts.github : null, s, "in sync"));
      } else {
        reports.push({ label: s.label, outcome: s.outcome, detail: s.detail });
      }
    } catch (e) {
      reports.push({ label: s.label, outcome: "failed", detail: deps.redact(describe(e)) });
    }
  }
  return reports;
}

function renderReports(reports: SiteReport[], dry: boolean): { output: string; code: number } {
  const lines = [
    `Prismic pull-sync — ${reports.length} site(s)${dry ? " (dry: nothing pushed, no PR opened)" : ""}`,
    "",
  ];
  for (const r of reports) {
    lines.push(`${r.outcome.padEnd(10)} ${r.label} — ${r.detail.split("\n").join(" ")}`);
  }
  const count = (o: SiteOutcome): number => reports.filter((r) => r.outcome === o).length;
  lines.push(
    "",
    `PRISMIC_SYNC_SUMMARY sites=${reports.length} opened=${count("opened")} updated=${count(
      "updated",
    )} unchanged=${count("unchanged")} closed=${count("closed")} in_sync=${count(
      "in-sync",
    )} would_open=${count("would-open")} held=${count("held")} declined=${count("declined")} skipped=${count("skipped")} failed=${count("failed")}`,
  );
  return { output: lines.join("\n"), code: count("failed") > 0 ? 1 : 0 };
}

function isPlan(x: unknown): x is SyncPlan {
  const p = x as { version?: unknown; sites?: unknown };
  return p?.version === 1 && Array.isArray(p.sites);
}

async function runPublishStage(
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
  cwd: string,
): Promise<{ output: string; code: number }> {
  if (!opts.plan || !opts.built) {
    return { output: "--stage publish needs --plan <dir> and --built <dir>.", code: 2 };
  }
  let plan: unknown;
  try {
    plan = JSON.parse(await readFile(join(resolve(cwd, opts.plan), "plan.json"), "utf-8"));
  } catch (e) {
    return { output: `⛔ could not read the fetch stage's plan: ${describe(e)}`, code: 1 };
  }
  if (!isPlan(plan)) return { output: "⛔ the fetch stage's plan is not a plan.", code: 1 };
  const openPrs = opts.openPrs === true;
  let github: SyncGitHub | null = null;
  if (openPrs) {
    try {
      github = deps.github();
    } catch (e) {
      return { output: `⛔ cannot open pull requests: ${describe(e)}`, code: 1 };
    }
  }
  const workdir = resolve(cwd, opts.workdir ?? fleetWorkdir());
  await mkdir(workdir, { recursive: true });
  const reports = await publishPlan(plan, resolve(cwd, opts.built), deps, {
    workdir,
    openPrs,
    github,
  });
  return renderReports(reports, !openPrs);
}

/** `--fleet` with no stage: the fetch stage alone, as a dry run. It runs no
 *  site code and opens nothing, so it is safe wherever the tokens are. */
async function runDryFleet(
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
  cwd: string,
): Promise<{ output: string; code: number }> {
  if (opts.openPrs === true) {
    return {
      output:
        "--open-prs needs --stage publish: a site's own tools run only in the build stage, which" +
        " holds no credential. Nothing was synced or written.",
      code: 2,
    };
  }
  const fleet = await resolveFleet(opts, deps, cwd);
  if (!("sites" in fleet)) return fleet;
  let github: SyncGitHub | null;
  try {
    github = deps.github();
  } catch {
    github = null;
  }
  const outDir = await mkdtemp(join(fleet.workdir, "dry-plan-"));
  const plan = await fetchPlan(fleet.sites, deps, { workdir: fleet.workdir, outDir, github });
  const reports: SiteReport[] = plan.sites.map((s) => {
    if (s.outcome !== "build") return { label: s.label, outcome: s.outcome, detail: s.detail };
    const models = [...s.sync.changed, ...s.sync.adopted];
    return {
      label: s.label,
      outcome: "would-open",
      detail:
        `would push ${SYNC_BRANCH} with ${s.sync.changed.length} changed, ${s.sync.adopted.length} adopted: ` +
        models.map((m) => `${m.kind} ${m.id}`).join(", "),
    };
  });
  return renderReports(reports, true);
}

/** In-process stages, for tests: fetch, then `build` per site, then publish. */
export async function runStagedFleet(
  opts: PrismicSyncOptions & { stageRoot: string },
  deps: PrismicSyncDeps,
  build: (inDir: string, outDir: string) => Promise<void>,
): Promise<{ output: string; code: number }> {
  const planDir = join(opts.stageRoot, "plan");
  const builtDir = join(opts.stageRoot, "built");
  const fetched = await runFetchStage({ ...opts, out: planDir }, deps, opts.cwd ?? process.cwd());
  if (fetched.code !== 0) return fetched;
  const ids = JSON.parse(await readFile(join(planDir, "matrix.json"), "utf-8")) as string[];
  for (const id of ids) await build(join(planDir, "sites", id), join(builtDir, id));
  return runPublishStage(
    { ...opts, plan: planDir, built: builtDir },
    deps,
    opts.cwd ?? process.cwd(),
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function prismicSync(
  site: string | undefined,
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  if (opts.fleet !== undefined) {
    if (site !== undefined) {
      return { output: "cannot combine a positional [site] with --fleet.", code: 2 };
    }
    if (opts.stage === "fetch") return runFetchStage(opts, deps, cwd);
    if (opts.stage === "publish") return runPublishStage(opts, deps, cwd);
    if (opts.stage !== undefined) {
      return { output: `unknown --stage ${opts.stage}: use fetch or publish.`, code: 2 };
    }
    return runDryFleet(opts, deps, cwd);
  }
  if (
    opts.openPrs === true ||
    opts.workdir !== undefined ||
    opts.stage !== undefined ||
    opts.out !== undefined ||
    opts.plan !== undefined ||
    opts.built !== undefined
  ) {
    return {
      output:
        "--open-prs, --workdir and --stage need --fleet: a single-site sync writes into this working" +
        " tree and opens nothing. Nothing was synced or written.",
      code: 2,
    };
  }
  const root = site ? resolve(cwd, site) : cwd;
  return renderLocal(await syncSiteModels(root, deps.models, { allowGenericToken: true }));
}

const API = "https://api.github.com";

/** REST through `fetch` with the App token: four calls, no GraphQL. */
export function makeSyncGitHub(token: string, fetchImpl: typeof fetch = fetch): SyncGitHub {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${API}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(
        `GitHub ${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    return res.status === 204 ? null : await res.json();
  };
  const asPr = (x: unknown): OpenPr => {
    const p = x as { number?: unknown; html_url?: unknown };
    if (typeof p.number !== "number" || typeof p.html_url !== "string") {
      throw new Error("GitHub answered with something that is not a pull request");
    }
    return { number: p.number, url: p.html_url };
  };
  return {
    async findOpenPr(repo, head, base) {
      const owner = repo.split("/")[0];
      const list = await call(
        "GET",
        `repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&per_page=10`,
      );
      if (!Array.isArray(list)) throw new Error(`GitHub's PR list for ${repo} was not a list`);
      if (list.length > 1) {
        throw new Error(`${repo} has ${list.length} open PRs from ${head}; expected at most one`);
      }
      return list.length === 1 ? asPr(list[0]) : null;
    },
    async createPr(repo, pr) {
      return asPr(await call("POST", `repos/${repo}/pulls`, pr));
    },
    async updatePr(repo, number, pr) {
      await call("PATCH", `repos/${repo}/pulls/${number}`, pr);
    },
    async isArchived(repo) {
      const r = (await call("GET", `repos/${repo}`)) as { archived?: unknown };
      if (typeof r.archived !== "boolean")
        throw new Error(`GitHub did not say whether ${repo} is archived`);
      return r.archived;
    },
    async closedUnmergedPrs(repo, head, base) {
      const owner = repo.split("/")[0];
      const list = await call(
        "GET",
        `repos/${repo}/pulls?state=closed&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}&per_page=30`,
      );
      if (!Array.isArray(list)) throw new Error(`GitHub's PR list for ${repo} was not a list`);
      return list.flatMap((x) => {
        const p = x as { merged_at?: unknown; body?: unknown };
        if (p.merged_at !== null) return [];
        return [{ ...asPr(x), body: typeof p.body === "string" ? p.body : "" }];
      });
    },
    async closePr(repo, number, comment) {
      const pr = (await call("GET", `repos/${repo}/pulls/${number}`)) as { body?: unknown };
      const body = withoutModelsKey(typeof pr.body === "string" ? pr.body : "");
      await call("POST", `repos/${repo}/issues/${number}/comments`, { body: comment });
      await call("PATCH", `repos/${repo}/pulls/${number}`, { state: "closed", body });
    },
  };
}

/**
 * The environment of every process this module starts (git, tar). Every
 * credential the job holds is removed: git gets the token only as a per-command
 * header, and only for the commands that talk to GitHub. No site's own code
 * runs in these jobs at all; that happens in the build stage, which holds none.
 */
export function siteProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(GH_|GITHUB_TOKEN$|PRISMIC_|TURSO_|ACTIONS_|RENOVATE_)/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** git's per-command auth header for github.com, so the token is never written
 *  into a clone's `.git/config`, where the site's own processes could read it. */
export const gitAuthArgs = (token: string): string[] =>
  token === ""
    ? []
    : [
        "-c",
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(
          `x-access-token:${token}`,
        ).toString("base64")}`,
      ];

/** Never run a hook or an fsmonitor from a clone of a site repo. */
const SAFE_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

/** The only git commands that talk to GitHub, and so the only ones given the
 *  token. git hands `-c` values to everything it runs, so a local command
 *  carrying it would carry it to whatever that command runs too. */
const NETWORK_GIT = new Set(["clone", "ls-remote", "fetch", "push"]);

export function defaultSyncDeps(
  env: Record<string, string | undefined> = process.env,
): PrismicSyncDeps {
  const spawn: SpawnFn = makeSpawn();
  const token = env.GH_TOKEN ?? "";
  const auth = gitAuthArgs(token);
  const header = auth[1] ?? "";
  const blob = token === "" ? "" : Buffer.from(`x-access-token:${token}`).toString("base64");
  const siteEnv = siteProcessEnv(process.env);
  // git reads nothing outside the clone: no global or system config, and a
  // HOME nothing else uses. A config there could name a helper for a
  // token-bearing push, and git hands every helper each `-c` value, the
  // token's header included.
  const gitHome = mkdtempSync(join(tmpdir(), "prismic-sync-git-home-"));
  const gitEnv: NodeJS.ProcessEnv = {
    ...siteEnv,
    HOME: gitHome,
    XDG_CONFIG_HOME: gitHome,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  return {
    models: defaultModelDeps(),
    resolveSites: (fleet, workdir, cwd) => resolveSites({ fleet, workdir, cwd }),
    git: (args, cwd, extra) =>
      spawn("git", [...SAFE_GIT, ...(NETWORK_GIT.has(args[0] ?? "") ? auth : []), ...args], {
        cwd,
        timeoutMs: 120_000,
        env: { ...gitEnv, ...extra },
      }),
    github: () => {
      if (token === "") throw new Error("GH_TOKEN is not set");
      return makeSyncGitHub(token);
    },
    cloneUrl: (repo) => `https://github.com/${repo}.git`,
    redact: (text) => {
      let out = text;
      for (const secret of [token, header, blob]) {
        if (secret !== "") out = out.split(secret).join("***");
      }
      return out;
    },
    archive: async (root, tarFile) => {
      const r = await spawn("tar", ["--exclude=./.git", "-cf", tarFile, "-C", root, "."], {
        timeoutMs: 300_000,
        env: siteEnv,
      });
      if (r.code !== 0) throw new Error(`tar failed (${r.code}): ${r.stderr.trim().slice(-500)}`);
    },
  };
}

export async function runPrismicSyncCommand(
  site: string | undefined,
  opts: PrismicSyncOptions,
): Promise<{ output: string; code: number }> {
  return prismicSync(site, opts, defaultSyncDeps());
}
