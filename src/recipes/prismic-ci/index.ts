import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { readGitHubConfig } from "../../github/config.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";
import { readPrismicConfig } from "../../prismic/models/index.js";
import type { RecipeResult, Site } from "../../types.js";
import {
  branchName,
  checkoutBranch,
  commit as gitCommit,
  createBranch,
  currentBranch,
  deleteBranch,
  isOwnerRepo,
  isWorkingTreeClean,
  push as gitPush,
} from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import { formatWithPrettier, resolveTargetPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  APPLY_BRANCH,
  PRISMIC_CI_WORKFLOW,
  REUSABLE_WORKFLOW_PIN,
  SECRET,
  WORKFLOW_PATH,
  isPinResolved,
  prismicCiWorkflow,
  type ReusableWorkflowPin,
} from "./template.js";

/** Head-branch prefix of every PR this recipe opens. `branchName("prismic-ci")`
 *  produces `maint/prismic-ci-<timestamp>`, and the re-run guard matches on this
 *  prefix — the same idiom as `findOpenSelfUpdatingPR`. */
const BRANCH_PREFIX = "maint/prismic-ci-";

/** How long the target's prettier gets. Also what makes the fleet's default
 *  spawn detach the child, so the kill reaches prettier and not just a wrapper.
 *  Matches the pull-down path's budget in `src/prismic/models/write.ts`. */
const PRETTIER_TIMEOUT_MS = 60_000;

/** Just the GitHub surface this recipe touches, so a test fake is five methods
 *  rather than thirty. `makeGitHub()` satisfies it structurally. */
export type PrismicCiGitHub = Pick<
  GitHub,
  "defaultBranch" | "secretExists" | "fileContentsOnBranch" | "openPullRequest" | "openPullRequests"
>;

export type PrismicCiDeps = {
  github?: PrismicCiGitHub;
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  spawn?: SpawnFn;
  /** Resolve the TARGET repo's own prettier. Injected so a test can assert the
   *  absolute-path spawn without a populated `node_modules`. */
  resolvePrettier?: (repoRoot: string) => Promise<string | null>;
  /** Which `reddoorla/.github` commit the written workflow pins. Injected only
   *  by tests; production uses the shipped pin. */
  pin?: ReusableWorkflowPin;
};

const resultOf = (
  site: Site,
  status: RecipeResult["status"],
  notes: string,
  commits: string[] = [],
): RecipeResult => ({
  recipe: "prismic-ci",
  site: siteLabel(site),
  status,
  commits,
  notes,
});

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Same normalization as `self-updating`'s config comparison: CRLF and a stray
 *  trailing newline are not drift, and treating them as drift opens a needless
 *  PR on every run. Any real content difference still differs. */
function sameWorkflow(current: string, canonical: string): boolean {
  const norm = (s: string) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  return norm(current) === norm(canonical);
}

/**
 * Land the Prismic model delivery workflow in one repo, as a pull request.
 *
 * Everything before the first mutation is a gate, and the gates exist because
 * this recipe's output is the only path in the project that writes to a live
 * client's Prismic repository. Two of them are worth naming:
 *
 *  - THE SECRET. A workflow whose `PRISMIC_WRITE_TOKEN` does not exist yet goes
 *    red on the repo's first model PR. Landing 15 of those turns a rollout into
 *    15 red repos, so a definitively-absent secret FAILS the site rather than
 *    nooping it: "this site was skipped and a human must act" is not the same
 *    report as "this site was already done", and a rollout summary where those
 *    two look alike is how a site silently never gets model delivery. A secret
 *    whose existence could not be DETERMINED fails too, with different wording —
 *    they are different facts and the operator's next move differs.
 *
 *  - THE DEFAULT BRANCH. The reusable workflow's apply job hard-codes
 *    `refs/heads/main`. On a repo whose default branch is anything else, every
 *    model PR would merge green and never reach Prismic. Refuse instead.
 *
 * Nothing here can delete a model: the workflow it installs calls a module that
 * exports no delete path.
 */
export async function prismicCi(site: Site, deps: PrismicCiDeps = {}): Promise<RecipeResult> {
  // 1. Repo identity. `failed`, not `noop`: a rollout that silently skips a site
  //    is the failure this whole recipe is guarding against one level up. The
  //    strict shape check runs BEFORE the first `gh` call, so a typo'd or
  //    attacker-controlled value can never be interpolated into an API path.
  const repo = site.gitRepo;
  if (!repo) {
    return resultOf(site, "failed", "no Git repo on this site (set Airtable 'Git repo')");
  }
  if (!isOwnerRepo(repo)) {
    return resultOf(
      site,
      "failed",
      `refusing to act on malformed repo identity: expected "owner/repo", got ${JSON.stringify(repo)}`,
    );
  }

  // 2. Is this a Prismic site? `readPrismicConfig` returns null for "no Prismic
  //    here" and THROWS for a present-but-unreadable config — the distinction is
  //    the point, so the throw becomes `failed` rather than being caught into
  //    the skip branch.
  let isPrismic: boolean;
  try {
    isPrismic = (await readPrismicConfig(site.path)) !== null;
  } catch (err) {
    return resultOf(site, "failed", `could not read the Prismic config: ${messageOf(err)}`);
  }
  if (!isPrismic) return resultOf(site, "noop", "not a Prismic site (no repositoryName) — skipped");

  // 3. The pin. Checked before any network call: while it is unresolved NOTHING
  //    can roll out, and 15 pointless API round-trips are not worth spending to
  //    find that out per site.
  const pin = deps.pin ?? REUSABLE_WORKFLOW_PIN;
  if (!isPinResolved(pin)) {
    return resultOf(
      site,
      "failed",
      `reusable-workflow pin is unresolved (${pin.sha}) — publish + tag the workflow in ` +
        `reddoorla/.github and set REUSABLE_WORKFLOW_PIN before rolling out`,
    );
  }
  const workflow = pin === REUSABLE_WORKFLOW_PIN ? PRISMIC_CI_WORKFLOW : prismicCiWorkflow(pin);

  const ghConfig = readGitHubConfig();
  if (!deps.github && !ghConfig) return resultOf(site, "failed", "GITHUB_TOKEN not set");
  const gh = deps.github ?? makeGitHub({ token: ghConfig!.token });
  const spawn = deps.spawn ?? defaultSpawn;

  // 4. The secret. Absent and unreadable are separate answers with separate
  //    wording; neither proceeds.
  let hasSecret: boolean;
  try {
    hasSecret = await gh.secretExists(repo, SECRET);
  } catch (err) {
    return resultOf(
      site,
      "failed",
      `could not determine whether ${repo} has the ${SECRET} secret (${messageOf(err)}) — ` +
        `refusing to install a workflow that may have no token`,
    );
  }
  if (!hasSecret) {
    return resultOf(
      site,
      "failed",
      `${repo} has no ${SECRET} Actions secret — the workflow reds the repo on its first ` +
        `model PR without it. Mint one, then: gh secret set ${SECRET} --repo ${repo}`,
    );
  }

  // 5. The default branch. NOT `.catch(() => "main")`: "I could not read the
  //    default branch" and "the default branch is main" are opposite facts, and
  //    guessing the second targets a PR (and an apply gate) at a branch nobody
  //    confirmed.
  let base: string;
  try {
    base = await gh.defaultBranch(repo);
  } catch (err) {
    return resultOf(
      site,
      "failed",
      `could not read the default branch of ${repo}: ${messageOf(err)}`,
    );
  }
  if (base !== APPLY_BRANCH) {
    return resultOf(
      site,
      "failed",
      `default branch of ${repo} is ${base}, not ${APPLY_BRANCH} — the reusable workflow's ` +
        `apply job guards refs/heads/${APPLY_BRANCH}, so merged model changes would never reach Prismic`,
    );
  }

  // 6. Already delivered? Content-compared, not existence-compared, so a
  //    present-but-STALE workflow (an older pin) is corrected rather than left
  //    forever.
  const existing = await gh.fileContentsOnBranch(repo, base, WORKFLOW_PATH);
  if (existing !== null && sameWorkflow(existing, workflow)) {
    return resultOf(site, "noop", `delivery workflow already current on ${base}`);
  }

  // 7. Already proposed? Without this, every run before the PR merges opens
  //    another one. `fileContentsOnBranch` also answers null for a read it could
  //    not perform (gh exits non-zero on both a 404 and an auth failure), which
  //    makes this the backstop for that collapse as well.
  const open = (await gh.openPullRequests(repo)).find((pr) => pr.headRef.startsWith(BRANCH_PREFIX));
  if (open) {
    return resultOf(site, "noop", `delivery workflow PR already open: ${open.url}`);
  }

  if (!(await isWorkingTreeClean(site.path))) {
    return resultOf(site, "failed", "working tree not clean — commit or stash first");
  }

  // Capture the operator's branch BEFORE creating ours so the `finally` can put
  // them back. Best-effort: if we cannot read it we skip the restore rather than
  // guess at a branch to check out.
  let original: string | null = null;
  try {
    original = await currentBranch(site.path);
  } catch {
    // Stays null (detached HEAD, git error) — the restore below is then skipped
    // rather than aiming a checkout at a branch name we had to invent.
  }
  const branch = branchName("prismic-ci");
  const commits: string[] = [];
  let pushedOrOpened = false;

  try {
    await createBranch(site.path, branch);
    const dest = join(site.path, WORKFLOW_PATH);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, workflow, "utf-8");

    // Format with the SITE's own prettier, resolved POSITIVELY and run by
    // absolute path. `pnpm exec prettier` here would run a full `pnpm install`
    // in the client's repo first (an unrequested mutation of a live client repo
    // by a rollout that is supposed to add one file), and in a repo without
    // prettier would then format with the CALLING repo's binary and exit 0.
    const notes: string[] = [];
    const bin = await (deps.resolvePrettier ?? resolveTargetPrettier)(site.path);
    if (bin === null) {
      notes.push(PRETTIER_FLAG_NOTE);
    } else if (
      !(await formatWithPrettier(spawn, site.path, [WORKFLOW_PATH], {
        bin,
        timeoutMs: PRETTIER_TIMEOUT_MS,
      }))
    ) {
      notes.push(PRETTIER_FLAG_NOTE);
    } else if (!sameWorkflow(await readFile(dest, "utf-8"), workflow)) {
      // The site's prettier config disagrees with the template's shape (single
      // quotes, a different tab width). Harmless for the workflow — but the
      // step-6 comparison is byte-based, so this site will not recognise its own
      // delivered workflow as current and will propose it again after each
      // merge. Say so rather than let it be discovered as a mystery PR.
      notes.push(
        "this site's prettier reformatted the workflow — re-runs will not match it as current",
      );
    }

    const sha = await gitCommit(site.path, "ci: deliver Prismic model changes from merged PRs");
    if (!sha) {
      // Git saw no change: the checkout already holds this exact workflow even
      // though the default branch does not. Nothing to push and nothing to
      // review — and pushing a commit-less branch would fail at PR creation.
      return resultOf(
        site,
        "noop",
        `${WORKFLOW_PATH} already present and identical in the checkout`,
      );
    }
    commits.push(sha);
    pushedOrOpened = true;
    await (deps.pushBranch ?? gitPush)(site.path, branch);
    const pr = await gh.openPullRequest(repo, {
      head: branch,
      base,
      title: "Deliver Prismic model changes from merged PRs",
      body:
        "Adds the `prismic-models` workflow. On a PR touching `customtypes/**` or " +
        "`src/lib/slices/**/model.json` it comments the model delta and writes nothing; " +
        "on merge to main it pushes those models to Prismic. It can create and update " +
        "models but never delete — a model present only in Prismic is reported, not touched.",
    });
    notes.unshift(`opened PR ${pr.url}`);
    return resultOf(site, "applied", notes.join("; "), commits);
  } catch (err) {
    return resultOf(site, "failed", messageOf(err), commits);
  } finally {
    // Restore the operator's branch on success AND on failure — otherwise a push
    // error strands the checkout on the recipe branch with an unpushed commit,
    // and the retry dies at createBranch. Best-effort; never masks the result.
    if (original !== null && original !== branch) {
      try {
        await checkoutBranch(site.path, original);
        // Nothing was pushed and no PR exists, so the local branch is litter and
        // a re-run would leave another. Only ever the branch WE created.
        if (!pushedOrOpened) await deleteBranch(site.path, branch);
      } catch (err) {
        console.warn(
          `warning: could not restore branch ${original} after prismic-ci: ${messageOf(err)}`,
        );
      }
    }
  }
}
