import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { templatesByName } from "../sync-configs/templates.js";
import {
  getRemoteUrl,
  parseOwnerRepo,
  push as gitPush,
  branchName,
  createBranch,
  commit as gitCommit,
  isWorkingTreeClean,
} from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import { readGitHubConfig } from "../../github/config.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";

const SELF_UPDATING_CONFIGS = ["ci", "renovate-action", "renovate-config"] as const;

export type SelfUpdatingDeps = {
  github?: GitHub;
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  renovateToken?: string;
};

function resultOf(
  site: Site,
  status: RecipeResult["status"],
  notes: string,
  commits: string[] = [],
): RecipeResult {
  return { recipe: "self-updating", site: siteLabel(site), status, commits, notes };
}

async function resolveRepo(site: Site): Promise<string | null> {
  if (site.gitRepo) return site.gitRepo;
  try {
    return parseOwnerRepo(await getRemoteUrl(site.path));
  } catch {
    return null;
  }
}

export async function selfUpdating(site: Site, deps: SelfUpdatingDeps = {}): Promise<RecipeResult> {
  const templates = templatesByName([...SELF_UPDATING_CONFIGS]);
  const paths = templates.map((t) => t.path);

  const repo = await resolveRepo(site);
  if (!repo) {
    return resultOf(
      site,
      "failed",
      "no Git repo (set Airtable 'Git repo' or add an origin remote)",
    );
  }

  const cfg = readGitHubConfig();
  const renovateToken = deps.renovateToken ?? cfg?.renovateToken;
  if (!deps.github && !cfg) return resultOf(site, "failed", "GITHUB_TOKEN not set");
  if (!renovateToken) return resultOf(site, "failed", "no RENOVATE_TOKEN available");
  const github = deps.github ?? makeGitHub({ token: cfg!.token });

  const base = await github.defaultBranch(repo).catch(() => "main");
  const actions: string[] = [];
  const commits: string[] = [];

  try {
    // A. CI files on the default branch.
    const present = await github.filesOnBranch(repo, base, paths);
    if (present.length < paths.length) {
      const existingPR = await github.findOpenSelfUpdatingPR(repo);
      if (existingPR) {
        actions.push(`bootstrap PR already open: ${existingPR}`);
      } else {
        if (!(await isWorkingTreeClean(site.path))) {
          return resultOf(site, "failed", "working tree not clean — commit or stash first");
        }
        const branch = branchName("self-updating");
        await createBranch(site.path, branch);
        for (const t of templates) {
          const dest = join(site.path, t.path);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, t.contents, "utf-8");
        }
        const sha = await gitCommit(
          site.path,
          "ci: enable self-updating (CI + Renovate auto-merge)",
        );
        if (sha) commits.push(sha);
        await (deps.pushBranch ?? gitPush)(site.path, branch);
        const pr = await github.openPullRequest(repo, {
          head: branch,
          base,
          title: "Enable self-updating (CI + Renovate)",
          body: "Adds the unified CI gate, nightly Renovate, and auto-merge for patch/minor updates.",
        });
        actions.push(`opened PR ${pr.url}`);
      }
    }

    // B. Repo settings — check-then-ensure, each independent (self-healing).
    if (!(await github.autoMergeEnabled(repo))) {
      await github.enableRepoAutoMerge(repo);
      actions.push("enabled auto-merge");
    }
    if (!(await github.branchProtectionContexts(repo, base)).includes("ci")) {
      await github.protectBranch(repo, base, ["ci"]);
      actions.push(`required ci check on ${base}`);
    }
    if (!(await github.secretExists(repo, "RENOVATE_TOKEN"))) {
      await github.setRepoSecret(repo, "RENOVATE_TOKEN", renovateToken);
      actions.push("set RENOVATE_TOKEN secret");
    }
  } catch (err) {
    const done = actions.length ? ` (completed: ${actions.join("; ")})` : "";
    return resultOf(site, "failed", `${(err as Error).message}${done}`, commits);
  }

  return actions.length
    ? resultOf(site, "applied", actions.join("; "), commits)
    : resultOf(site, "noop", "already self-updating", commits);
}
