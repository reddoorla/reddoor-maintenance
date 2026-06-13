import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { templatesByName } from "../sync-configs/templates.js";
import {
  getRemoteUrl,
  parseOwnerRepo,
  isOwnerRepo,
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

// Reusable-workflow jobs report their check as "<caller-job> / <reusable-job>".
// The thin `ci` caller (job `ci`) calls reddoorla/.github's reusable workflow (job `ci`),
// so the required context is "ci / ci", NOT "ci". (Provisional — verified empirically on the
// starter during M7.1 rollout; correct here if the live checks API reports a different string.)
const REQUIRED_CHECK = "ci / ci";

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

/**
 * Resolve the `owner/repo` this recipe will mutate. An explicit `site.gitRepo`
 * (from Airtable) wins; otherwise derive it from the checkout's `origin`.
 *
 * Returns `null` when there is no repo to act on (no `gitRepo`, no origin) — a
 * benign "nothing wired" state. THROWS when a repo value IS present but doesn't
 * match the strict `owner/repo` shape: this recipe writes the broad GitHub
 * token as a repo secret (plus branch protection / auto-merge) at this
 * identity, so an attacker/typo-controlled value must be rejected here, before
 * the first `gh` call, rather than passed through to `gh`.
 */
async function resolveRepo(site: Site): Promise<string | null> {
  if (site.gitRepo) {
    if (!isOwnerRepo(site.gitRepo)) {
      throw new Error(
        `refusing to act on malformed repo identity: expected "owner/repo", got ${JSON.stringify(site.gitRepo)}`,
      );
    }
    return site.gitRepo;
  }
  let fromOrigin: string | null;
  try {
    fromOrigin = parseOwnerRepo(await getRemoteUrl(site.path));
  } catch {
    return null;
  }
  if (fromOrigin === null) return null;
  if (!isOwnerRepo(fromOrigin)) {
    throw new Error(
      `refusing to act on malformed repo identity from origin: ${JSON.stringify(fromOrigin)}`,
    );
  }
  return fromOrigin;
}

export async function selfUpdating(site: Site, deps: SelfUpdatingDeps = {}): Promise<RecipeResult> {
  const templates = templatesByName([...SELF_UPDATING_CONFIGS]);
  const paths = templates.map((t) => t.path);

  let repo: string | null;
  try {
    repo = await resolveRepo(site);
  } catch (err) {
    // A malformed repo identity must abort before any `gh` write — surface it
    // as a recipe failure rather than letting the token reach an unintended repo.
    return resultOf(site, "failed", err instanceof Error ? err.message : String(err));
  }
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
    if (!(await github.branchProtectionContexts(repo, base)).includes(REQUIRED_CHECK)) {
      // protectBranch issues a full PUT that REPLACES required-status-check contexts (not merges).
      // Pre-existing required contexts on a repo are dropped — acceptable here because this recipe
      // only ever needs the single CI context, and M7.1 rollout verifies contexts per-repo.
      await github.protectBranch(repo, base, [REQUIRED_CHECK]);
      actions.push(`required "${REQUIRED_CHECK}" check on ${base}`);
    }
    if (!(await github.secretExists(repo, "RENOVATE_TOKEN"))) {
      await github.setRepoSecret(repo, "RENOVATE_TOKEN", renovateToken);
      actions.push("set RENOVATE_TOKEN secret");
    }
  } catch (err) {
    const done = actions.length ? ` (completed: ${actions.join("; ")})` : "";
    const message = err instanceof Error ? err.message : String(err);
    return resultOf(site, "failed", `${message}${done}`, commits);
  }

  return actions.length
    ? resultOf(site, "applied", actions.join("; "), commits)
    : resultOf(site, "noop", "already self-updating", commits);
}
