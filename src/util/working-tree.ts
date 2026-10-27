/** Directory entries that are NOT evidence of a checked-out working tree. A
 *  directory containing only these is git metadata (or Finder litter) with no
 *  repository checked out into it — see {@link noWorkingTreeFailure}. */
const NOT_A_WORKING_TREE: ReadonlySet<string> = new Set([".git", ".DS_Store"]);

/**
 * POSITIVE EVIDENCE OF A CHECKOUT, or the named reason there is none.
 *
 * A `readdir` that succeeds proves the DIRECTORY is readable. It does not prove
 * anything was checked out into it, and every verdict a Prismic command draws is
 * drawn from what is NOT in that directory — so without this, "I could not
 * establish a checkout" comes out as "this repo has no Prismic in it".
 *
 * The gap that makes it severe is durability. `cloneIfNeeded` accepts ANY
 * non-empty directory at the site's path as that site's checkout
 * (clone-if-needed.ts:138), and `git clone` creates `.git` FIRST and fills the
 * working tree afterwards — so a clone killed in between (its own 5-minute
 * timeout, a cancelled job, a reboot, a full disk) leaves `<workdir>/<slug>/`
 * holding `.git` alone, with `origin` already pointing at the right repo. That
 * directory is non-empty, so no clone is ever attempted again; every config read
 * inside it is ENOENT, so `readPrismicConfig` returns null; and the site then
 * reports "not a Prismic site — skipped", exit 0, ON EVERY RUN AFTER THE FIRST.
 * One interrupted clone silently retires that site's drift alarm, and a fleet of
 * them is a green sweep. In the rollout command it is the same directory, one
 * decision earlier: the site is quietly never offered the delivery workflow.
 *
 * THE REAL CAUSE IS ONE LAYER DOWN and is deliberately not fixed here:
 * `cloneIfNeeded`'s "non-empty directory ⇒ this is the checkout" rule, and its
 * identity guard, which RETURNS SILENTLY when it cannot verify
 * (clone-if-needed.ts:100 — a directory with no git origin is treated as
 * verified). Both are shared by nine fleet commands, so changing them from one
 * command would be an unreviewed fleet-wide behaviour change; that deserves its
 * own task. This guard makes the Prismic commands honest meanwhile — the answer
 * it refuses to give is the DANGEROUS one ("no Prismic here"), never the safe
 * one.
 *
 * It lives in `util/` rather than in either command because two copies of a
 * guard are two chances to fix only one of them: `prismic-models` (which reads)
 * and `prismic-ci` (which opens a PR against a repo) reach the identical
 * directory by the identical route.
 *
 * `.DS_Store` sits alongside `.git` because a fleet workdir on darwin acquires
 * one from Finder, and it is no more a working tree than `.git` is.
 */
export function noWorkingTreeFailure(
  repoRoot: string,
  entries: readonly string[],
  noEffect: string,
): string | null {
  if (!entries.every((e) => NOT_A_WORKING_TREE.has(e))) return null;
  return (
    `this checkout has no working tree: ${repoRoot} holds` +
    ` ${entries.length === 0 ? "nothing at all" : `only ${entries.join(", ")}`}.` +
    ` ${noEffect} — this is NOT "no Prismic in this repo"; nothing at all was established` +
    ` about this repo. A git clone killed part-way leaves exactly this (a .git and no files),` +
    ` and a fleet workdir REUSES any non-empty directory as that site's checkout, so it will` +
    ` never re-clone by itself. Delete ${repoRoot} and re-run.`
  );
}
