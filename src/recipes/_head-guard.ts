import { rm, rmdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ignoreRulesFor, pathsMissingFromHead } from "../util/git.js";

/** A refusal: what git did not take, and what to tell the operator about it. */
export type HeadRefusal = {
  /** The subset of the manifest that is NOT in HEAD's tree. */
  missing: string[];
  /** Operator-facing: what is absent from the commit, and which rule excluded it. */
  notes: string;
};

/** Appended by a caller that has already put the refused paths back. */
export const RESTORED_NOTE =
  "Everything this run wrote to those paths has been put back as it was.";

/**
 * POSITIVE EVIDENCE that the commit really carries `installed`: every path must
 * be FOUND in HEAD's tree. `commit()` stages with `git add -A`, which honours
 * the target site's `.gitignore` and exits 0 either way, and git cannot
 * re-include a file whose PARENT DIRECTORY is excluded. So a recipe can write
 * its files to disk, commit none of them, and report success — #734 for
 * `match-harness`, generalised to every recipe that creates NEW paths by #741.
 *
 * `what` names the install in the operator's terms ("the /health endpoint").
 * Returns null when every path landed — i.e. the guard GRANTS.
 *
 * PRESENCE, NOT CONTENT: a path in HEAD with the wrong bytes passes here. This
 * answers "the commit contains what the recipe says it installed", and must
 * never be read as "the recipe worked".
 */
export async function refusedByGit(
  cwd: string,
  installed: readonly string[],
  what: string,
): Promise<HeadRefusal | null> {
  const missing = await pathsMissingFromHead(cwd, installed);
  if (missing.length === 0) return null;

  // `<source>:<line>:<pattern>\t<path>` rows. A missing path with no row is
  // absent for some other reason (a nested repository, say) and is reported as
  // such rather than guessed at.
  const rules = await ignoreRulesFor(cwd, missing);
  const sources = [...new Set(rules.map((r) => r.split("\t")[0]!))];
  const explained = new Set(rules.map((r) => r.split("\t")[1] ?? ""));
  const unexplained = missing.filter((p) => !explained.has(p));

  return {
    missing,
    notes:
      `${what} was NOT installed: ${missing.length} of ${installed.length} paths git refused to ` +
      `track, so a fresh clone and CI get nothing. Absent from the commit: ${missing.join(", ")}. ` +
      (sources.length > 0
        ? `Excluded by ${sources.join(", ")} — narrow or remove those rules and re-run. `
        : "") +
      (unexplained.length > 0
        ? `No ignore rule matched ${unexplained.join(", ")} — check .git/info/exclude, ` +
          `core.excludesFile, and whether the directory is a nested repository. `
        : ""),
  };
}

/**
 * Put the checkout back exactly as this run found it, for the paths git refused.
 * Only paths THIS RUN wrote are touched — `before` maps each to its prior
 * content, or null when it did not exist; a path that reached the commit is left
 * to the caller's branch restore, and one we never wrote is never ours.
 * `git checkout -f` cannot do this job: these paths are ignored, so git does not
 * know they exist.
 *
 * Without it the residue is worse than the defect. Every recipe here noops on
 * "already exists", so the file git refused would make the NEXT run report the
 * site done over a path no clone will ever have.
 */
export async function undoRefusedWrites(
  cwd: string,
  before: ReadonlyMap<string, string | null>,
  missing: readonly string[],
): Promise<void> {
  const removed: string[] = [];
  for (const [rel, prev] of before) {
    if (!missing.includes(rel)) continue;
    if (prev === null) {
      await rm(join(cwd, rel), { force: true });
      removed.push(rel);
    } else {
      await writeFile(join(cwd, rel), prev, "utf-8");
    }
  }
  // Prune the directories this run created, deepest first and only while they
  // are empty: rmdir refuses a non-empty directory, which is exactly the guard
  // wanted, and the walk upward stops at the first one that is someone else's.
  for (const rel of removed) {
    let d = dirname(rel);
    while (d !== "." && d !== "/" && d !== "") {
      try {
        await rmdir(join(cwd, d));
      } catch {
        break;
      }
      d = dirname(d);
    }
  }
}
