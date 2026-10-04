// The D1 pull-sync (operator decision, 2026-10-01; identity 2026-10-04): an edit
// made in Prismic's Type Builder lands in Prismic first, and this brings it back
// to the repo as ONE reviewed pull request per site, so the repo stays the
// source of truth.
//
// Two modes:
//
//   - `prismic-sync [site]` writes Prismic's copy of every changed and every
//     remote-only model into ONE working tree, for a human to review and commit.
//   - `prismic-sync --fleet <inventory>` clones each site fresh, syncs it, and
//     with `--open-prs` commits the result to the fixed branch `prismic-sync`
//     and opens or updates one PR against the default branch. Without
//     `--open-prs` it pushes nothing and reports what each PR would hold.
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
import { mkdir, mkdtemp, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { makeSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { isOwnerRepo } from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import type { Site } from "../../types.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../../recipes/_prettier.js";
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
  /** Closed and NOT merged sync PRs, with the head commit each was closed at. */
  closedUnmergedPrs: (
    repo: string,
    head: string,
    base: string,
  ) => Promise<Array<OpenPr & { headSha: string }>>;
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
  install: (root: string) => Promise<void>;
  codegen: (root: string) => Promise<void>;
  format: (root: string, paths: readonly string[]) => Promise<boolean>;
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
  notes: { regenerated: boolean | "not-migrated"; unformatted: boolean },
): string {
  const out: string[] = [
    SYNC_MARKER,
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
// Fleet: clone, sync, commit, PR
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

/** Files the sync may leave changed: the models it wrote, and on a migrated
 *  site the two generated files. Anything else in `git status` is refused. */
function expectedPath(path: string, models: ReadonlySet<string>, libraries: string[]): boolean {
  if (models.has(path)) return true;
  if (path === "prismicio-types.d.ts") return true;
  return libraries.some((lib) => {
    const dir = posix.normalize(lib.replace(/^\.\//, "")).replace(/\/+$/, "");
    return path === `${dir}/index.ts` || path === `${dir}/index.js`;
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

/** Paths `git status` reports as changed or new, untracked files listed singly. */
async function changedPaths(deps: PrismicSyncDeps, root: string): Promise<string[]> {
  const r = await mustGit(deps, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
  return r
    .split("\0")
    .filter((e) => e.length > 3)
    .map((e) => e.slice(3));
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

async function syncOneSite(
  site: Site,
  deps: PrismicSyncDeps,
  opts: { workdir: string; openPrs: boolean; github: SyncGitHub | null },
): Promise<SiteReport> {
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
  const branchRef = `refs/remotes/origin/${SYNC_BRANCH}`;
  // The full ref, matched exactly: `ls-remote origin prismic-sync` also matches
  // any `*/prismic-sync`, such as a human's `fix/prismic-sync`.
  const branchExists = (
    await mustGit(deps, ["ls-remote", "origin", `refs/heads/${SYNC_BRANCH}`], root)
  )
    .split("\n")
    .some((l) => l.split("\t")[1] === `refs/heads/${SYNC_BRANCH}`);
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
    const authors = (
      await mustGit(deps, ["log", "--format=%ae%n%ce", `${baseHead}..${branchRef}`], root)
    )
      .split("\n")
      .filter((a) => a !== "" && a !== SYNC_AUTHOR.email);
    if (authors.length > 0) {
      return {
        label,
        outcome: "held",
        detail:
          `${SYNC_BRANCH} carries commits the sync did not make (${[...new Set(authors)].join(", ")}),` +
          ` so it was left untouched. Merge or close its PR and remove the branch to resume.`,
      };
    }
  }

  // No process may run during the model writes here. They format with the
  // clone's own `node_modules/.bin/prettier` when one exists, and a repo can
  // commit one: it would run with this job's full environment, before the
  // checks below. Formatting happens later, through `deps.format`, with
  // every credential removed.
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

  const open = opts.github ? await opts.github.findOpenPr(repo, SYNC_BRANCH, base) : null;

  // Nothing left for the PR to bring in. Repo-only models may remain (the repo
  // is ahead on those), so the comment does not claim the two agree.
  const nothingToBring = async (why: string): Promise<SiteReport> => {
    if (open && opts.github) {
      await opts.github.closePr(
        repo,
        open.number,
        `${SYNC_MARKER}\nPrismic repository **${r.repositoryName}** holds nothing tonight that the ` +
          `repo's \`${base}\` lacks, so this sync PR has nothing left to bring in` +
          (r.localOnly.length > 0
            ? ` (${r.localOnly.length} model(s) exist only in the repo; they reach Prismic on merge).`
            : ".") +
          ` Closed by the nightly pull-sync.`,
      );
      return { label, outcome: "closed", detail: `${why}; closed ${open.url}` };
    }
    return { label, outcome: "in-sync", detail: why };
  };

  const models = written(r);
  if (models.length === 0) return nothingToBring("in sync");

  // The site's own code runs from here (its install, prettier and prismic CLI).
  // Whatever it might plant where the git commands below would execute it, a
  // hook, an fsmonitor, a URL rewrite, shows up as a change in these files.
  const before = await gitControlFingerprint(root);
  await deps.install(root);
  const paths = models.map((m) => m.path);
  const formatted = await deps.format(root, paths);
  const migrated = await exists(join(root, "prismic.config.json"));
  if (migrated) await deps.codegen(root);
  if ((await gitControlFingerprint(root)) !== before) {
    return {
      label,
      outcome: "failed",
      detail:
        "the site's own install or tools changed .git/config, .git/hooks or .git/info, so" +
        " nothing was committed or pushed from this clone.",
    };
  }

  const libraries = await readLibraries(root);
  const modelSet = new Set(paths);
  const stray = (await changedPaths(deps, root)).filter(
    (p) => !expectedPath(p, modelSet, libraries),
  );
  if (stray.length > 0) {
    return {
      label,
      outcome: "failed",
      detail: `the sync left files it does not own changed, so nothing was committed: ${stray.join(", ")}`,
    };
  }

  await mustGit(deps, ["add", "-A", "--", "."], root);
  const tree = (await mustGit(deps, ["write-tree"], root)).trim();
  const baseTree = (await mustGit(deps, ["rev-parse", `${baseHead}^{tree}`], root)).trim();
  if (tree === baseTree) return nothingToBring("the models differ only in ways git does not see");

  const title = syncPrTitle(r.repositoryName);
  const body = renderSyncPrBody(r, {
    regenerated: migrated ? true : "not-migrated",
    unformatted: !formatted,
  });
  const summary =
    `${r.changed.length} changed, ${r.adopted.length} adopted: ` +
    models.map((m) => `${m.kind} ${m.id}`).join(", ");

  if (!opts.openPrs || !opts.github) {
    return { label, outcome: "would-open", detail: `would push ${SYNC_BRANCH} with ${summary}` };
  }

  let pushed = false;
  let headSha = branchExists ? (await mustGit(deps, ["rev-parse", branchRef], root)).trim() : "";
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
    headSha = commit;
  }

  if (open) {
    // Only when the branch moved: a human's edit to the title or body of a PR
    // whose content did not change is theirs to keep.
    if (pushed) await opts.github.updatePr(repo, open.number, { title, body });
    return {
      label,
      outcome: pushed ? "updated" : "unchanged",
      detail: `${pushed ? "pushed and updated" : "already current"} ${open.url} — ${summary}`,
    };
  }
  // A human closed a sync PR at exactly this commit: they judged the
  // direction (most likely "the repo is ahead"). Reopening the same change
  // every night would only offer the wrong merge again. A new Prismic edit
  // makes a new commit, which gets a new PR.
  const declined = (await opts.github.closedUnmergedPrs(repo, SYNC_BRANCH, base)).find(
    (p) => p.headSha === headSha,
  );
  if (declined) {
    return {
      label,
      outcome: "declined",
      detail: `${declined.url} was closed unmerged at this same commit; not reopened — ${summary}`,
    };
  }
  const created = await opts.github.createPr(repo, { head: SYNC_BRANCH, base, title, body });
  return { label, outcome: "opened", detail: `opened ${created.url} — ${summary}` };
}

/** The spawner the fleet's model writes get: none. */
const refuseSpawn: SpawnFn = async (cmd) => {
  throw new Error(`no process may run during a fleet sync's model writes (asked for ${cmd})`);
};

/** The contents of the files in a clone that decide what git itself runs. */
async function gitControlFingerprint(root: string): Promise<string> {
  const parts: string[] = [];
  const add = async (rel: string): Promise<void> => {
    const full = join(root, ".git", rel);
    let entries: string[] | null;
    try {
      entries = (await readdir(full)).sort();
    } catch {
      entries = null;
    }
    if (entries !== null) {
      for (const e of entries) await add(`${rel}/${e}`);
      return;
    }
    let body: string;
    try {
      body = await readFile(full, "utf-8");
    } catch (e) {
      body = `<${(e as NodeJS.ErrnoException).code ?? "unreadable"}>`;
    }
    parts.push(`${rel}\0${body}`);
  };
  for (const rel of ["config", "hooks", "info"]) await add(rel);
  return parts.join("\0\0");
}

/** The configured slice libraries, read the way the sync's own reads did. */
async function readLibraries(root: string): Promise<string[]> {
  const { readPrismicConfig } = await import("../../prismic/models/index.js");
  return (await readPrismicConfig(root))?.libraries ?? [];
}

async function runFleet(
  opts: PrismicSyncOptions,
  deps: PrismicSyncDeps,
  cwd: string,
): Promise<{ output: string; code: number }> {
  const openPrs = opts.openPrs === true;
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

  let github: SyncGitHub | null = null;
  if (openPrs) {
    try {
      github = deps.github();
    } catch (e) {
      return { output: `⛔ cannot open pull requests: ${describe(e)}`, code: 1 };
    }
  }

  const reports: SiteReport[] = [];
  for (const site of sites) {
    try {
      reports.push(await syncOneSite(site, deps, { workdir, openPrs, github }));
    } catch (e) {
      reports.push({ label: siteLabel(site), outcome: "failed", detail: deps.redact(describe(e)) });
    }
  }

  const lines = [
    `Prismic pull-sync — ${sites.length} site(s)${openPrs ? "" : " (dry: nothing pushed, no PR opened)"}`,
    "",
  ];
  for (const r of reports) {
    lines.push(`${r.outcome.padEnd(10)} ${r.label} — ${r.detail.split("\n").join(" ")}`);
  }
  const count = (o: SiteOutcome): number => reports.filter((r) => r.outcome === o).length;
  lines.push(
    "",
    `PRISMIC_SYNC_SUMMARY sites=${sites.length} opened=${count("opened")} updated=${count(
      "updated",
    )} unchanged=${count("unchanged")} closed=${count("closed")} in_sync=${count(
      "in-sync",
    )} would_open=${count("would-open")} held=${count("held")} declined=${count("declined")} skipped=${count("skipped")} failed=${count("failed")}`,
  );
  return { output: lines.join("\n"), code: count("failed") > 0 ? 1 : 0 };
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
    return runFleet(opts, deps, cwd);
  }
  if (opts.openPrs === true || opts.workdir !== undefined) {
    return {
      output:
        "--open-prs and --workdir need --fleet: a single-site sync writes into this working" +
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
        const p = x as { merged_at?: unknown; head?: { sha?: unknown } };
        if (p.merged_at !== null || typeof p.head?.sha !== "string") return [];
        return [{ ...asPr(x), headSha: p.head.sha }];
      });
    },
    async closePr(repo, number, comment) {
      await call("POST", `repos/${repo}/issues/${number}/comments`, { body: comment });
      await call("PATCH", `repos/${repo}/pulls/${number}`, { state: "closed" });
    },
  };
}

/**
 * The environment a site's OWN code runs in: `pnpm install`, its prettier and
 * its `prismic` CLI. Every credential this job holds is removed first: the App
 * token can push to every repo in the org, and the Prismic and Turso secrets
 * are other clients'. A dependency of one site must not be handed any of them.
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
  const siteEnv = siteProcessEnv(process.env);
  const siteSpawn: SpawnFn = (cmd, args, opts) => spawn(cmd, args, { ...opts, env: siteEnv });
  return {
    models: defaultModelDeps(),
    resolveSites: (fleet, workdir, cwd) => resolveSites({ fleet, workdir, cwd }),
    git: (args, cwd, extra) =>
      spawn("git", [...SAFE_GIT, ...(NETWORK_GIT.has(args[0] ?? "") ? auth : []), ...args], {
        cwd,
        timeoutMs: 120_000,
        env: { ...siteEnv, GIT_TERMINAL_PROMPT: "0", ...extra },
      }),
    github: () => {
      if (token === "") throw new Error("GH_TOKEN is not set");
      return makeSyncGitHub(token);
    },
    cloneUrl: (repo) => `https://github.com/${repo}.git`,
    redact: (text) => {
      let out = text;
      for (const secret of [token, header]) if (secret !== "") out = out.split(secret).join("***");
      return out;
    },
    install: async (root) => {
      if (!(await exists(join(root, "package.json")))) return;
      const r = await siteSpawn(
        "pnpm",
        ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"],
        {
          cwd: root,
          timeoutMs: 300_000,
        },
      );
      if (r.code !== 0) {
        throw new Error(`pnpm install failed (${r.code}): ${r.stderr.trim().slice(-500)}`);
      }
    },
    codegen: async (root) => {
      let bin: string;
      try {
        bin = await realpath(join(root, "node_modules", ".bin", "prismic"));
      } catch {
        throw new Error(
          "this site has prismic.config.json but no prismic CLI in node_modules, so its generated files cannot be regenerated",
        );
      }
      for (const args of [
        ["gen", "types"],
        ["gen", "slice-index"],
      ]) {
        const r = await siteSpawn(bin, args, { cwd: root, timeoutMs: 120_000 });
        if (r.code !== 0) {
          throw new Error(
            `prismic ${args.join(" ")} failed (${r.code}): ${r.stderr.trim().slice(-500)}`,
          );
        }
      }
    },
    format: async (root, paths) => {
      let bin: string;
      try {
        bin = await realpath(join(root, "node_modules", ".bin", "prettier"));
      } catch {
        return false;
      }
      return formatWithPrettier(siteSpawn, root, paths, { bin, timeoutMs: 60_000 });
    },
  };
}

export async function runPrismicSyncCommand(
  site: string | undefined,
  opts: PrismicSyncOptions,
): Promise<{ output: string; code: number }> {
  return prismicSync(site, opts, defaultSyncDeps());
}
