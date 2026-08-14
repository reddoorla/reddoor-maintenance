import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { SpawnFn } from "../audits/util/spawn.js";

/** Flag note recipes surface when best-effort formatting couldn't run, so the
 * operator knows to eyeball CI's format check for that site. */
export const PRETTIER_FLAG_NOTE =
  "could not prettier-format written files (prettier unavailable?) — verify CI formatting";

/**
 * The target repo's OWN prettier, as an absolute path, or null when it has none.
 *
 * This is how a caller obtains {@link FormatWithPrettierOptions.bin}, and a
 * recipe that has not just run `pnpm install` in the target MUST use it rather
 * than the `pnpm exec` default — see that option's comment for what `pnpm exec`
 * does to a client repo with no `node_modules` (a full unrequested install,
 * then a fall-through to the CALLING repo's prettier, then exit 0).
 *
 * `node_modules/.bin/prettier` under the repo root is the right probe rather
 * than a resolve-from-`repoRoot`: Node's algorithm walks UP, which would find
 * the maintenance repo's own prettier for any clone checked out beneath it —
 * the precise confusion this exists to end.
 *
 * Every failure collapses to null on purpose, EACCES included: unlike a read
 * whose result decides what gets written, "I cannot tell" here costs only
 * `formatted: false`, which is the conservative flag and the documented degraded
 * path. `realpath` doubles as the existence probe, so a DANGLING shim reads as
 * absent rather than present.
 *
 * (`src/prismic/models/write.ts` keeps a private twin of this. The duplication
 * is deliberate: that module takes formatting as an injected capability
 * specifically so it does not import from `src/recipes/`.)
 */
export async function resolveTargetPrettier(repoRoot: string): Promise<string | null> {
  try {
    return await realpath(join(repoRoot, "node_modules", ".bin", "prettier"));
  } catch {
    return null;
  }
}

export type FormatWithPrettierOptions = {
  /**
   * Absolute path to the prettier executable to run, INSTEAD of going through
   * `pnpm exec`.
   *
   * `pnpm exec prettier` picks the binary by resolution — the project's
   * `node_modules/.bin` if it is populated, otherwise whatever `prettier` the
   * ambient PATH offers. That is fine for a recipe that has just run
   * `pnpm install` in the site, and wrong for a caller that has not: measured
   * 2026-08-13 in a fixture repo with no `node_modules`, `pnpm exec prettier`
   * silently ran a `pnpm install` in the target and then, in a repo that does
   * not depend on prettier at all, fell through to the CALLING repo's prettier
   * and exited 0 — reporting success for a format the target never did.
   *
   * A caller that has POSITIVELY resolved the target's own prettier passes it
   * here, so nothing about which binary runs is left to resolution.
   */
  bin?: string;
  /** Passed straight to the spawn. Also what makes {@link SpawnFn}'s default
   *  implementation detach the child, so a timeout kills the whole process
   *  group rather than just the wrapper. Omitted = no timeout, the historical
   *  behaviour of this helper's two recipe callers. */
  timeoutMs?: number;
};

/**
 * Format recipe-written files with the SITE's own prettier, so they match that
 * site's config — quote style, tabs vs spaces, and printWidth all vary across
 * the fleet, and a single hardcoded template style reds the CI format check on
 * the sites that differ.
 *
 * Best-effort by contract: returns `false` (never throws) when prettier isn't
 * installed, exits non-zero, or times out, so a recipe can commit the file
 * unformatted and flag it rather than fail the whole rollout. Files in the
 * site's `.prettierignore` are skipped by prettier itself. Returns `true`
 * immediately (no spawn) when `relPaths` is empty, so a recipe that wrote
 * nothing this run doesn't shell out.
 *
 * Only pass paths the recipe actually wrote/changed — never operator files it
 * left untouched, which must not be reformatted.
 */
export async function formatWithPrettier(
  spawn: SpawnFn,
  cwd: string,
  relPaths: readonly string[],
  opts: FormatWithPrettierOptions = {},
): Promise<boolean> {
  if (relPaths.length === 0) return true;
  const cmd = opts.bin ?? "pnpm";
  const args =
    opts.bin !== undefined
      ? ["--write", ...relPaths]
      : ["exec", "prettier", "--write", ...relPaths];
  try {
    const res = await spawn(cmd, args, {
      cwd,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return res.code === 0;
  } catch {
    return false;
  }
}
