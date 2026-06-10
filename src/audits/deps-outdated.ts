import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { SpawnFn } from "./util/spawn.js";

/** Real installed-version drift, distinct from the declared-range "drift" the
 *  deps audit computes against the baseline: how many dependencies are behind
 *  the registry's latest, per the committed lockfile. */
export type OutdatedCounts = { outdated: number; major: number };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function majorOf(version: string): number {
  const head = version.replace(/^[\^~]/, "").split(".")[0] ?? "0";
  const n = Number.parseInt(head, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Count outdated dependencies for a site, using its committed lockfile as the
 * source of truth for "what's installed/deployed". Returns `null` (skip — the
 * caller degrades gracefully) when it can't determine this:
 *  - no `pnpm-lock.yaml` (not a pnpm site, or never installed)
 *  - the lockfile is stale vs package.json (`--frozen-lockfile` install fails)
 *  - `pnpm outdated` output isn't parseable
 *
 * `pnpm outdated` exits non-zero precisely WHEN there are outdated packages, so
 * its exit code is ignored and only its JSON is parsed. `--frozen-lockfile`
 * never mutates the lockfile, so this stays read-only with respect to the repo.
 */
export async function scanOutdated(
  sitePath: string,
  spawn: SpawnFn,
): Promise<OutdatedCounts | null> {
  if (!(await exists(join(sitePath, "pnpm-lock.yaml")))) return null;

  // Everything below is best-effort: a thrown spawn (timeout, `pnpm` not on
  // PATH, spawn error) must degrade to a skip (null), NOT bubble up and flip the
  // whole deps audit to a hard fail — the declared-range drift is independent of
  // pnpm and must still report. (Mirrors securityAudit's try/catch.)
  try {
    // Materialize node_modules from the lockfile, but only when it's missing —
    // an already-installed checkout skips the cold install. `--frozen-lockfile`
    // never rewrites the lockfile (read-only wrt the repo) and fails fast on a
    // lockfile out of sync with package.json → skip.
    if (!(await exists(join(sitePath, "node_modules")))) {
      const install = await spawn("pnpm", ["install", "--frozen-lockfile"], {
        cwd: sitePath,
        timeoutMs: 180_000,
      });
      if (install.code !== 0) return null;
    }

    // `pnpm outdated` exits non-zero precisely WHEN there are outdated packages,
    // so its exit code is ignored and only its JSON is parsed.
    const res = await spawn("pnpm", ["outdated", "--json"], {
      cwd: sitePath,
      timeoutMs: 60_000,
    });
    const parsed = JSON.parse(res.stdout || "{}") as Record<
      string,
      { current?: string; latest?: string }
    >;
    const entries = Object.values(parsed);
    return {
      outdated: entries.length,
      major: entries.filter((e) => e.current && e.latest && majorOf(e.latest) > majorOf(e.current))
        .length,
    };
  } catch {
    return null;
  }
}
