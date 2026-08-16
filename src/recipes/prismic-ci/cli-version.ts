import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The first published version whose `reddoor-maint` bin carries `prismic-models`.
 *
 * VERIFIED BY INSTALLING IT, not by reading a changelog: `npm i
 * @reddoorla/maintenance@0.83.0` in an empty directory, then `reddoor-maint
 * prismic-models --help`, prints the command's usage. Every earlier published
 * version — 0.82.0 included — exits with "unknown command".
 *
 * This matters because the reusable workflow does NOT install the CLI. It runs
 * `pnpm install --frozen-lockfile` and then the site's own installed bin, so the
 * version that executes in a client repo is whatever that repo's lockfile pins.
 * Installing the caller workflow next to an older binary produces a workflow
 * that fails at the first model PR, in a client repo, with an error about an
 * unknown command rather than about a rollout that ran too early.
 */
export const MIN_CLI_VERSION = "0.83.0";

/** The dependency whose version decides whether the workflow can run at all. */
const PACKAGE = "@reddoorla/maintenance";

/**
 * `version >= min`, compared NUMERICALLY, position by position.
 *
 * Not a string comparison, and not `localeCompare`: as strings `"0.9.0" >
 * "0.83.0"`, so a lexicographic gate waves through a site pinned seventy-four
 * releases before the command existed. That is the single most likely way for
 * this gate to be wrong while looking right.
 *
 * A prerelease (`0.83.0-beta.1`) sorts BELOW the release it precedes, per
 * semver. The fleet publishes no prereleases today; the rule is here so that if
 * one ever appears it is not silently treated as the release.
 */
export function atLeast(version: string, min: string): boolean {
  const parse = (v: string): { nums: number[]; pre: boolean } => {
    const [core = "", ...rest] = v.split("-");
    return {
      nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
      pre: rest.length > 0,
    };
  };
  const a = parse(version);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    const av = a.nums[i] ?? 0;
    const bv = b.nums[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  // Cores equal: a prerelease of the minimum is below it; anything else is equal.
  if (a.pre && !b.pre) return false;
  return true;
}

/** Either the version pnpm resolved, or WHY that could not be established.
 *  The two are deliberately different shapes: a caller cannot read "I could not
 *  tell" as a version by forgetting to check a flag. */
export type LockedCliVersion = { ok: true; version: string } | { ok: false; reason: string };

/**
 * The version of {@link PACKAGE} the repo's committed pnpm lockfile resolves.
 *
 * Reads the LOCKFILE, never `package.json`. The declared range is not what
 * executes: espada declares `^0.81.0` and its lockfile resolves 0.69.0, and CI
 * installs `--frozen-lockfile`. A gate reading the range would pass a site whose
 * install is two dozen releases behind it.
 *
 * Parsed with a targeted scan rather than a YAML dependency — this needs one
 * field out of one block, the repo carries no YAML parser, and adding one to
 * read a single `version:` line is not a trade worth making. The scan is
 * deliberately narrow: it reads only `importers:` entries (what is installed),
 * never the `packages:`/`snapshots:` sections, which list every transitively
 * resolvable version and would happily report one nobody installed.
 *
 * Every failure is a NAMED reason, never a version and never a silent default.
 * A gate that cannot tell "too old" from "could not read" reports one as the
 * other, which is the absent-vs-unreadable collapse this whole feature exists to
 * prevent — arriving here at the last step before writing to a client repo.
 */
export async function readLockedCliVersion(repoRoot: string): Promise<LockedCliVersion> {
  let raw: string;
  try {
    raw = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT is the only error meaning "this repo has no lockfile". EACCES and
    // friends mean it is there and unreadable — a different answer, and one that
    // must not read as "not a pnpm site".
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: `no pnpm-lock.yaml in the checkout — cannot tell which ${PACKAGE} version CI would run`,
      };
    }
    return { ok: false, reason: `pnpm-lock.yaml is present but unreadable (${String(err)})` };
  }

  // Only inside `importers:` — see the note above on packages:/snapshots:.
  const lines = raw.split("\n");
  const importersAt = lines.findIndex((l) => /^importers:\s*$/.test(l));
  if (importersAt === -1) {
    return {
      ok: false,
      reason: "pnpm-lock.yaml has no `importers:` section — unrecognised lockfile shape",
    };
  }
  const end = lines.findIndex((l, i) => i > importersAt && /^[a-zA-Z]/.test(l));
  const importers = lines.slice(importersAt + 1, end === -1 ? lines.length : end);

  const found = new Set<string>();
  for (let i = 0; i < importers.length; i++) {
    if (!new RegExp(`^\\s+'?${PACKAGE.replace("/", "\\/")}'?:\\s*$`).test(importers[i]!)) continue;
    // The entry's own `version:` sits within the next few lines, alongside
    // `specifier:`. Bounded so a malformed block cannot walk into the next
    // dependency and attribute its version to this one.
    for (let j = i + 1; j < Math.min(i + 4, importers.length); j++) {
      const m = /^\s+version:\s*(\S+)\s*$/.exec(importers[j]!);
      if (!m) continue;
      // Strip the peer-dependency suffix: real fleet lockfiles run it past 400
      // characters after the semver.
      found.add(m[1]!.split("(")[0]!);
      break;
    }
  }

  if (found.size === 0) {
    return { ok: false, reason: `${PACKAGE} is not a dependency in this repo's lockfile` };
  }
  if (found.size > 1) {
    // Picking one would be a coin flip deciding whether a client repo gets a
    // workflow its binary cannot run.
    return {
      ok: false,
      reason: `lockfile resolves ${PACKAGE} to more than one version (${[...found].sort().join(", ")}) — refusing to guess which one CI would run`,
    };
  }
  return { ok: true, version: [...found][0]! };
}
