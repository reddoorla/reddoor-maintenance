import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** What this pipeline needs from a site's Prismic config. */
export type PrismicConfig = {
  /** The Prismic repository name — the `repository` header on every Types API call. */
  repositoryName: string;
  /** Slice library directories, repo-relative. Fleet-uniform at ["./src/lib/slices"],
   *  but read rather than assumed: alamo-anatomy points at a directory that does
   *  not exist, and assuming the path would make its models invisible instead of
   *  visibly empty. */
  libraries: string[];
};

/** Slice Machine's file, and the name the Prismic CLI renames it to. Both are
 *  read so an adopting repo does not go dark; slicemachine.config.json wins
 *  because that is what every Prismic repo in the fleet ships today — measured
 *  2026-08-12 across the 30 local checkouts: 17 carry a Prismic config and all
 *  17 use the Slice Machine name; none ships prismic.config.json yet. */
const CONFIG_FILES = ["slicemachine.config.json", "prismic.config.json"] as const;

/** The starter's placeholder. Measured 2026-08-12: 2 of those 17 configs
 *  (reddoor-starter, canvas-starter) still carry it unreplaced, which is what
 *  keeps their models out of this pipeline entirely. */
const SENTINEL = "your-prismic-repo-name";

/**
 * Read a repo's Prismic config, or null when it is not a Prismic site.
 *
 * null means "no Prismic here, skip this repo" — no config file at all, or a
 * repositoryName still set to the starter sentinel. A PRESENT but malformed or
 * unreadable config THROWS: a repo that has Prismic and a broken config must
 * surface as an error, never as a silent skip. That distinction is the whole
 * point of the return type, and it is a bigger lever here than anywhere else in
 * this module — one unreadable model file loses one model, but one unreadable
 * config drops a LIVE SITE out of the fleet sweep entirely, with the sweep
 * still reporting success.
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
    if (cfg.repositoryName === SENTINEL) return null;
    const libraries =
      Array.isArray(cfg.libraries) && cfg.libraries.every((l) => typeof l === "string")
        ? (cfg.libraries as string[])
        : ["./src/lib/slices"];
    return { repositoryName: cfg.repositoryName, libraries };
  }
  return null;
}
