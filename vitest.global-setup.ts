import { execFileSync } from "node:child_process";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Decide whether `dist/` must be rebuilt before the suite runs. Pure so it can
 * be unit-tested without touching the filesystem.
 *
 * The CLI tests `execFileSync` the compiled `dist/cli/bin.js`; if `dist` is
 * stale, those tests silently pass/fail against OLD code (this trap cost real
 * time in the 2026-06-05 and 2026-06-09 work). A `pretest` npm hook would only
 * cover `pnpm test` — `pnpm exec vitest` / watch bypass it — so the guard lives
 * in globalSetup, which runs for every vitest invocation.
 *
 * @param distMtimeMs    mtime of `dist/cli/bin.js`, or `null` if it doesn't exist
 * @param inputMtimesMs  mtimes of every build input (src/** plus the build
 *                       config and dependency manifests)
 */
export function distIsStale(distMtimeMs: number | null, inputMtimesMs: number[]): boolean {
  if (distMtimeMs === null) return true; // never built / missing
  if (inputMtimesMs.length === 0) return false; // nothing to be stale against
  return Math.max(...inputMtimesMs) > distMtimeMs;
}

function mtimeMsOrNull(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** mtimes of every file under `dir`, recursively. Defensive: a broken symlink
 *  or unreadable entry is skipped (via `mtimeMsOrNull`) rather than crashing
 *  the whole suite, and an unreadable directory yields `[]`. */
function fileMtimes(dir: string): number[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...fileMtimes(p));
    } else {
      const m = mtimeMsOrNull(p);
      if (m !== null) out.push(m);
    }
  }
  return out;
}

// Build inputs beyond src/: tsup bundles dependencies into the single
// dist/cli/bin.js, so a dep bump (package.json / pnpm-lock.yaml) or a build
// config change (tsup.config.ts) makes dist stale even when no src file moved —
// the exact trap this guard exists to catch (e.g. on a Renovate branch).
const EXTRA_BUILD_INPUTS = ["tsup.config.ts", "package.json", "pnpm-lock.yaml"];

/**
 * vitest globalSetup: rebuild `dist/` before the suite when it's missing or
 * older than any build input. In CI (which runs `pnpm build` immediately before
 * `pnpm test`) the staleness check sees a fresh dist and skips the rebuild, so
 * this adds no cost there — it only pays the ~4s build when an input actually
 * changed since the last build. (Watch mode runs globalSetup once at startup;
 * editing src mid-watch won't re-trigger it — rebuild manually for dist tests.)
 *
 * Staleness is keyed on `dist/cli/bin.js` — the CLI entry the tests exec, and a
 * file every build rewrites. This is sound because the build always runs AFTER
 * the input edits (so bin.js postdates them); it would only mislead if the build
 * itself wrote into `src/`, which it never does.
 */
export default function setup(): void {
  const distMtime = mtimeMsOrNull(join(ROOT, "dist", "cli", "bin.js"));
  const inputs = [
    ...fileMtimes(join(ROOT, "src")),
    ...EXTRA_BUILD_INPUTS.map((f) => mtimeMsOrNull(join(ROOT, f))).filter(
      (m): m is number => m !== null,
    ),
  ];
  if (distIsStale(distMtime, inputs)) {
    execFileSync("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
  }
}
