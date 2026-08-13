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
 *  because that is what all 18 live fleet sites ship today. */
const CONFIG_FILES = ["slicemachine.config.json", "prismic.config.json"] as const;

/** The starter's placeholder. Three fleet repos still carry it unreplaced. */
const SENTINEL = "your-prismic-repo-name";

/**
 * Read a repo's Prismic config, or null when it is not a Prismic site.
 *
 * null means "no Prismic here, skip this repo" — no config file at all, or a
 * repositoryName still set to the starter sentinel. A PRESENT but malformed
 * config THROWS: a repo that has Prismic and a broken config must surface as an
 * error, never as a silent skip. That distinction is the whole point of the
 * return type.
 */
export async function readPrismicConfig(repoRoot: string): Promise<PrismicConfig | null> {
  for (const name of CONFIG_FILES) {
    let raw: string;
    try {
      raw = await readFile(join(repoRoot, name), "utf-8");
    } catch {
      continue; // not this one
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${name}: invalid JSON (${(e as Error).message})`, { cause: e });
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
