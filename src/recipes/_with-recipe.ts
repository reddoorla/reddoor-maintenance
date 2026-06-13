import type { RecipeName, RecipeResult, Site } from "../types.js";
import {
  branchName,
  checkoutBranch,
  commit as gitCommit,
  createBranch,
  currentBranch,
  deleteBranch,
  forceCheckoutBranch,
  isWorkingTreeClean,
} from "../util/git.js";
import { siteLabel } from "../util/site.js";

/** Outcome of the read-only planning phase. `noop` and `failed` short-circuit
 * without creating a branch; `apply` carries the recipe-specific plan data
 * forward to the apply phase. */
export type RecipePlan<P> =
  | { kind: "noop"; notes?: string }
  | { kind: "failed"; notes: string }
  | { kind: "apply"; plan: P };

export type RecipeApplyCtx = {
  /** Stage all current changes and commit. Returns the SHA, or null if
   * nothing was staged. The wrapper accumulates SHAs into the final
   * RecipeResult. */
  commit: (message: string) => Promise<string | null>;
  /** Branch name that was created for this run. */
  branch: string;
  /** Site path — same as `site.path`. */
  cwd: string;
};

export type RecipeApplyResult = { kind: "ok"; notes?: string } | { kind: "failed"; notes: string };

export type RecipeBody<P> = {
  name: RecipeName;
  site: Site;
  /** Inspect the site and decide: noop, failed, or proceed (with plan data
   * passed to apply). Runs before the working-tree clean check unless
   * `checkTreeFirst: true` is set, so most recipes can noop on a dirty
   * tree without throwing. */
  plan: () => Promise<RecipePlan<P>>;
  /** Make the actual changes. Use `ctx.commit(msg)` for each logical step;
   * the wrapper collects SHAs into `RecipeResult.commits`. Return
   * `{ kind: "failed", notes }` to abort partway and surface the failure. */
  apply: (plan: P, ctx: RecipeApplyCtx) => Promise<RecipeApplyResult>;
  /** Check working tree clean BEFORE `plan()` runs. Use only when plan
   * itself mutates the tree (e.g. `bump-deps` runs `pnpm install` in plan
   * for an accurate outdated probe). Default false — clean check happens
   * after plan only if plan returns proceed, allowing noop-on-dirty for
   * read-only plans (a tree with stray edits + no recipe work to do
   * should not throw). */
  checkTreeFirst?: boolean;
};

/** Wrap a recipe's plan/apply phases. Centralises the siteLabel /
 * clean-tree check / branch creation / commit accumulation / RecipeResult
 * construction boilerplate that every recipe used to re-implement. */
export async function withRecipe<P>(body: RecipeBody<P>): Promise<RecipeResult> {
  const label = siteLabel(body.site);

  if (body.checkTreeFirst && !(await isWorkingTreeClean(body.site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${body.site.path}`);
  }

  const planned = await body.plan();

  if (planned.kind === "noop") {
    return {
      recipe: body.name,
      site: label,
      status: "noop",
      commits: [],
      ...(planned.notes ? { notes: planned.notes } : {}),
    };
  }
  if (planned.kind === "failed") {
    return {
      recipe: body.name,
      site: label,
      status: "failed",
      commits: [],
      notes: planned.notes,
    };
  }

  if (!body.checkTreeFirst && !(await isWorkingTreeClean(body.site.path))) {
    throw new Error(`refusing to run: working tree is not clean at ${body.site.path}`);
  }

  // Capture the operator's branch BEFORE we create the recipe branch, so we can
  // return them to it afterwards (#2) and so the failure path (#3) knows which
  // branch to force-restore to. Best-effort: if we can't read it (detached HEAD,
  // git error) we proceed with `original = null` and skip any force operations
  // rather than guess — we must NEVER force-discard/delete a branch we're unsure
  // of.
  let original: string | null = null;
  try {
    original = await currentBranch(body.site.path);
  } catch {
    original = null;
  }

  const branch = branchName(body.name);
  await createBranch(body.site.path, branch);

  /**
   * Best-effort restore to the operator's original branch. Never throws — a
   * restore failure must not turn an otherwise-clean recipe result into a
   * failure (#2). Skipped when we couldn't capture the original branch.
   *
   * IMPORTANT (composition): this is invoked only on the NOOP-from-apply path
   * (the recipe created a branch but committed nothing — leaving the operator
   * parked on an empty maint branch is pure downside). It is deliberately NOT
   * invoked on the APPLIED path: the fleet onboarding pipeline composes recipes
   * by running them in sequence against the SAME checkout, each building on the
   * prior's committed files in the working tree (convert-to-pnpm's lockfile →
   * onboard's deps → sync-configs → svelte-codemods). Restoring to the base
   * branch after an applied recipe would strip those files from the working
   * tree and break composition (verified live across the fleet). selfUpdating,
   * which PUSHES its branch, does its own post-push restore since its local
   * branch is disposable.
   */
  const restoreOriginal = async (): Promise<void> => {
    if (original === null || original === branch) return;
    try {
      await checkoutBranch(body.site.path, original);
    } catch (err) {
      // Leave the operator on the recipe branch rather than fail the result.
      console.warn(
        `warning: could not restore branch ${original} after ${body.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  /**
   * Failure restore (#3): force the checkout back to the captured original
   * branch (discarding the recipe branch's uncommitted changes) and delete the
   * recipe branch, so a re-run starts clean. SAFETY: only ever force-checks-out
   * the captured `original` and only ever deletes `branch` (the recipe-created
   * branch); never deletes `original`, never runs `git clean`. If `original` is
   * unavailable we do nothing (the safe subset) — better to leave the operator
   * parked than to force anything we're unsure about. Best-effort: never throws.
   */
  const restoreAfterFailure = async (): Promise<void> => {
    if (original === null || original === branch) return;
    try {
      await forceCheckoutBranch(body.site.path, original);
    } catch (err) {
      console.warn(
        `warning: could not force-restore branch ${original} after failed ${body.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // If we couldn't get off the recipe branch, deleting it would fail anyway;
      // and we must never delete the branch we're still on.
      return;
    }
    try {
      await deleteBranch(body.site.path, branch);
    } catch (err) {
      console.warn(
        `warning: could not delete recipe branch ${branch} after failed ${body.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const shas: string[] = [];
  let result: RecipeApplyResult;
  try {
    result = await body.apply(planned.plan, {
      cwd: body.site.path,
      branch,
      commit: async (msg) => {
        const sha = await gitCommit(body.site.path, msg);
        if (sha) shas.push(sha);
        return sha;
      },
    });
  } catch (err) {
    // Body threw mid-mutation: force-restore + delete the recipe branch so the
    // checkout is retriable, then re-throw (preserve the prior throw semantics —
    // callers like init treat an uncaught throw as an `error` step).
    await restoreAfterFailure();
    throw err;
  }

  if (result.kind === "failed") {
    await restoreAfterFailure();
    return {
      recipe: body.name,
      site: label,
      status: "failed",
      commits: shas,
      notes: result.notes,
    };
  }

  // NOOP-from-apply only: no commits to compose, so don't leave the operator
  // parked on an empty maint branch. The APPLIED path intentionally stays on the
  // maint branch so the onboarding pipeline can compose (see restoreOriginal).
  if (shas.length === 0) {
    await restoreOriginal();
  }

  const notes = result.notes ? `${result.notes}; branch: ${branch}` : `branch: ${branch}`;
  return {
    recipe: body.name,
    site: label,
    status: shas.length > 0 ? "applied" : "noop",
    commits: shas,
    notes,
  };
}
