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
  checkoutBranch,
  createBranch,
  currentBranch,
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

/** True when a file's current content matches the canonical template for drift
 *  purposes. Normalizes line endings + trailing whitespace so a stray trailing
 *  newline (or CRLF) can't read as drift and open a needless PR every nightly run;
 *  any real content change still differs. */
function sameConfigContents(current: string, canonical: string): boolean {
  const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return norm(current) === norm(canonical);
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
  // Hoisted so the `finally` can restore the operator's branch even when a
  // failure (push/PR error) aborts AFTER we created + checked out the maint
  // branch. `maintBranch` stays null until createBranch succeeds, so the
  // restore is a no-op on every path that never left the operator's branch.
  let original: string | null = null;
  let maintBranch: string | null = null;

  try {
    // A. CI/Renovate config on the default branch — compare CONTENT, not just
    // existence, so a present-but-STALE config (an old pinned reusable-workflow SHA,
    // a drifted Renovate schedule window) is corrected rather than left silently
    // forever. The prior existence-only gate reported "already self-updating" for any
    // repo that merely HAD the three files, however out of date — the very drift this
    // recipe exists to repair (e.g. the Renovate schedule-window regression).
    const drifted: string[] = [];
    for (const t of templates) {
      const current = await github.fileContentsOnBranch(repo, base, t.path);
      if (current === null || !sameConfigContents(current, t.contents)) drifted.push(t.path);
    }
    if (drifted.length > 0) {
      const existingPR = await github.findOpenSelfUpdatingPR(repo);
      if (existingPR) {
        actions.push(`self-updating PR already open: ${existingPR}`);
      } else {
        if (!(await isWorkingTreeClean(site.path))) {
          return resultOf(site, "failed", "working tree not clean — commit or stash first");
        }
        // Capture the operator's branch BEFORE creating the maint branch so the
        // `finally` can return them to it (#2). Best-effort capture: if it fails
        // we just skip the restore rather than guess.
        try {
          original = await currentBranch(site.path);
        } catch {
          original = null;
        }
        maintBranch = branchName("self-updating");
        await createBranch(site.path, maintBranch);
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
        await (deps.pushBranch ?? gitPush)(site.path, maintBranch);
        const pr = await github.openPullRequest(repo, {
          head: maintBranch,
          base,
          title: "Enable self-updating (CI + Renovate)",
          body: "Adds the unified CI gate, nightly Renovate, and auto-merge for patch/minor updates.",
        });
        actions.push(`opened PR ${pr.url}`);
        // (Branch restore happens in the `finally` below — on success AND on a
        // failure that aborts after createBranch.)
      }
    }

    // B. Repo settings — check-then-ensure, each independent (self-healing).
    if (!(await github.autoMergeEnabled(repo))) {
      await github.enableRepoAutoMerge(repo);
      actions.push("enabled auto-merge");
    }
    const existingContexts = await github.branchProtectionContexts(repo, base);
    if (!existingContexts.includes(REQUIRED_CHECK)) {
      // protectBranch issues a full PUT that REPLACES required-status-check contexts.
      // Send the UNION of the branch's existing required contexts + our REQUIRED_CHECK
      // so we ADD the CI gate without silently dropping any other checks the repo
      // already requires. (When the branch has no protection yet, existingContexts is
      // [] and this is just [REQUIRED_CHECK] — the original behavior.) Dedupe defends
      // against REQUIRED_CHECK already appearing among the existing contexts.
      const contexts = [...new Set([...existingContexts, REQUIRED_CHECK])];
      await github.protectBranch(repo, base, contexts);
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
  } finally {
    // Restore the operator's branch whenever we created + checked out a maint
    // branch — on SUCCESS and, critically, on FAILURE. Without this, a push/PR
    // error after createBranch strands the checkout on the maint branch with an
    // unpushed commit, and the retry then fails at createBranch ("branch already
    // exists"). Best-effort: a restore failure must not mask the real outcome.
    if (maintBranch !== null && original !== null && original !== maintBranch) {
      try {
        await checkoutBranch(site.path, original);
      } catch (err) {
        console.warn(
          `warning: could not restore branch ${original} after self-updating: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return actions.length
    ? resultOf(site, "applied", actions.join("; "), commits)
    : resultOf(site, "noop", "already self-updating", commits);
}
