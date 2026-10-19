import type { RecipeResult } from "../../types.js";

export type FormatRecipeResultOptions = {
  /** Printed after `noop:` when the result carries no notes. Default "". */
  noopNote?: string;
  /** Print `applied: N commit(s)` rather than a bare `applied`. Default true. */
  commitCount?: boolean;
};

/**
 * One result line (plus notes) for a recipe command's output, shared by every
 * command that runs a recipe through `runRecipeOverSites`. A `failed`
 * result always prints as `failed:`; bump-deps, upgrade and sync-configs once
 * had local copies without that branch and printed a failure as
 * `applied: 0 commit(s)`.
 */
export function formatRecipeResult(r: RecipeResult, opts: FormatRecipeResultOptions = {}): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? opts.noopNote ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  const applied = opts.commitCount === false ? "applied" : `applied: ${r.commits.length} commit(s)`;
  return `[${r.site}] ${applied}\n${r.notes ?? ""}`;
}
