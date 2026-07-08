import type { SpawnFn } from "../audits/util/spawn.js";

/** Flag note recipes surface when best-effort formatting couldn't run, so the
 * operator knows to eyeball CI's format check for that site. */
export const PRETTIER_FLAG_NOTE =
  "could not prettier-format written files (prettier unavailable?) — verify CI formatting";

/**
 * Format recipe-written files with the SITE's own prettier
 * (`pnpm exec prettier --write`), so they match that site's config — quote
 * style, tabs vs spaces, and printWidth all vary across the fleet, and a single
 * hardcoded template style reds the CI format check on the sites that differ.
 *
 * Best-effort by contract: returns `false` (never throws) when prettier isn't
 * installed or exits non-zero, so a recipe can commit the file unformatted and
 * flag it rather than fail the whole rollout. Files in the site's
 * `.prettierignore` are skipped by prettier itself. Returns `true` immediately
 * (no spawn) when `relPaths` is empty, so a recipe that wrote nothing this run
 * doesn't shell out.
 *
 * Only pass paths the recipe actually wrote/changed — never operator files it
 * left untouched, which must not be reformatted.
 */
export async function formatWithPrettier(
  spawn: SpawnFn,
  cwd: string,
  relPaths: readonly string[],
): Promise<boolean> {
  if (relPaths.length === 0) return true;
  try {
    const res = await spawn("pnpm", ["exec", "prettier", "--write", ...relPaths], { cwd });
    return res.code === 0;
  } catch {
    return false;
  }
}
