import type { RecipeName, RecipeResult, Site } from "../types.js";
import { branchName, commit as gitCommit, createBranch, isWorkingTreeClean } from "../util/git.js";
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

  const branch = branchName(body.name);
  await createBranch(body.site.path, branch);

  const shas: string[] = [];
  const result = await body.apply(planned.plan, {
    cwd: body.site.path,
    branch,
    commit: async (msg) => {
      const sha = await gitCommit(body.site.path, msg);
      if (sha) shas.push(sha);
      return sha;
    },
  });

  if (result.kind === "failed") {
    return {
      recipe: body.name,
      site: label,
      status: "failed",
      commits: shas,
      notes: result.notes,
    };
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
