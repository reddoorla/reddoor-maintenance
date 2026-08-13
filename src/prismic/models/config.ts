import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** What this pipeline needs from a site's Prismic config. */
export type PrismicConfig = {
  /** The Prismic repository name — the `repository` header on every Types API call. */
  repositoryName: string;
  /** Slice library directories, repo-relative. Fleet-uniform at ["./src/lib/slices"],
   *  but read rather than assumed: alamo-anatomy points at a directory that does
   *  not exist, and assuming the path would make its models invisible instead of
   *  visibly empty. An ABSENT key defaults; a present-but-malformed one throws
   *  (see {@link readPrismicConfig}). */
  libraries: string[];
};

/** Slice Machine's file, and the name the Prismic CLI renames it to, in
 *  preference order. Both are read so an adopting repo does not go dark;
 *  slicemachine.config.json is tried first because that is what every Prismic
 *  repo in the fleet ships today — measured 2026-08-12 across the 30 local
 *  checkouts: 17 carry a Prismic config and all 17 use the Slice Machine name;
 *  none ships prismic.config.json yet. That makes prismic.config.json the
 *  FORWARD path, which is exactly why a stale first file must not be allowed to
 *  mask it — see the sentinel handling in {@link readPrismicConfig}. */
const CONFIG_FILES = ["slicemachine.config.json", "prismic.config.json"] as const;

/** The starter's placeholder — a repo that has not been pointed at a real
 *  Prismic repository yet. Three fleet repos still carry it unreplaced:
 *  reddoor-starter, canvas-starter, and composition-hospitality. Only the first
 *  two are visible from a local sweep (verified 2026-08-12; the third has no
 *  local checkout and was confirmed through the GitHub API), so a measurement
 *  taken across `~/Documents/GitHub` finds two and is not evidence that the
 *  third is gone. */
const SENTINEL = "your-prismic-repo-name";

/**
 * Read a repo's Prismic config, or null when it is not a Prismic site.
 *
 * null means "no Prismic here, skip this repo" — no config file at all, or
 * every candidate file still carrying the starter sentinel. A PRESENT but
 * malformed or unreadable config THROWS: a repo that has Prismic and a broken
 * config must surface as an error, never as a silent skip. That distinction is
 * the whole point of the return type, and it is a bigger lever here than
 * anywhere else in this module — one unreadable model file loses one model, but
 * one unreadable config drops a LIVE SITE out of the fleet sweep entirely, with
 * the sweep still reporting success.
 *
 * A sentinel `repositoryName` means "not configured YET", so it moves to the
 * next candidate filename rather than ending the search. That matters because
 * the Prismic CLI's migration RENAMES slicemachine.config.json to
 * prismic.config.json, so a half-migrated repo can hold a stale sentinel in the
 * first file and its real configuration in the second. Returning null on the
 * first sight of a sentinel would drop that live site from the sweep on the
 * strength of a file nobody uses any more. Only when every candidate is
 * exhausted does a sentinel yield null.
 */
export async function readPrismicConfig(repoRoot: string): Promise<PrismicConfig | null> {
  for (const name of CONFIG_FILES) {
    let raw: string;
    try {
      raw = await readFile(join(repoRoot, name), "utf-8");
    } catch (e) {
      // ENOENT is the ONLY error that means "this repo does not have this
      // file". EACCES, EISDIR (a directory named slicemachine.config.json),
      // ELOOP and I/O errors all mean the file is THERE and we cannot read it —
      // and falling through on those would walk to the next candidate name and
      // then to `return null`, i.e. "not a Prismic site", silently removing a
      // live site from every sweep that calls this.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`${name}: present but unreadable (${(e as Error).message})`, { cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${name}: invalid JSON (${(e as Error).message})`, { cause: e });
    }
    // A config file containing literal `null` (or `[]`, or a bare string) is
    // valid JSON, so it arrives here parsed. Reading `.repositoryName` off it
    // would throw a bare `Cannot read properties of null` naming neither the
    // file nor the repo — the same nameless-throw defect just fixed one layer
    // down in local.ts, and worse here because this runs per REPO in a fleet
    // sweep, where "which one?" is the operator's first question.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      const got = parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed;
      throw new Error(`${name}: not a JSON object (got ${got})`);
    }
    const cfg = parsed as { repositoryName?: unknown; libraries?: unknown };
    if (typeof cfg.repositoryName !== "string" || cfg.repositoryName.trim() === "") {
      throw new Error(`${name}: repositoryName is missing or not a string`);
    }
    // Trimmed on the way OUT, not just for validation. Untrimmed, " espada "
    // would go verbatim into the Types API `repository` header and 404 — which
    // presents to an operator as "the Prismic repository does not exist" rather
    // than "your config has a stray space", sending them to the wrong problem.
    const repositoryName = cfg.repositoryName.trim();

    // Sentinel = "not configured yet" → try the next candidate filename rather
    // than declaring the repo non-Prismic. Checked before `libraries` because a
    // repo this pipeline never processes has no configuration worth validating.
    if (repositoryName === SENTINEL) continue;

    // ABSENT defaults; PRESENT-but-unusable throws. Replacing a malformed value
    // with the fleet default is the same collapse this module refuses
    // everywhere else: if the site's real library is somewhere other than the
    // default, every slice it owns reads as missing, and the sweep reports
    // "this site has no slices" as fact rather than "we could not tell".
    //
    // `libraries: []` is deliberately LEGAL and is not the same thing — an
    // explicitly empty array is a statement ("this site has no slice
    // libraries"), not a malformation. Do not "fix" it into the default.
    if (
      cfg.libraries !== undefined &&
      !(Array.isArray(cfg.libraries) && cfg.libraries.every((l) => typeof l === "string"))
    ) {
      const got = Array.isArray(cfg.libraries)
        ? "an array with a non-string entry"
        : cfg.libraries === null
          ? "null"
          : typeof cfg.libraries;
      throw new Error(`${name}: libraries is present but is not an array of strings (got ${got})`);
    }
    const libraries =
      cfg.libraries === undefined ? ["./src/lib/slices"] : (cfg.libraries as string[]);
    return { repositoryName, libraries };
  }
  return null;
}
