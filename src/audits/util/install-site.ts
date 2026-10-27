import { access } from "node:fs/promises";
import { join } from "node:path";
import type { SpawnFn } from "./spawn.js";

/**
 * P1-78c: install a fresh fleet clone so an audit that builds the site can run.
 * `prepareFleetSites` clones and never installs, and the a11y audit builds and
 * previews the site and imports `@axe-core/playwright` from its node_modules, so
 * on a clone it failed before scanning a route. Installs only when node_modules is
 * absent (a local checkout keeps its own), with smoke's retry: lockfile drift
 * should not red a site, and the clone is ephemeral, so one unfrozen retry is
 * harmless. With `browser`, it also installs the site's own Playwright chromium,
 * which the site's pinned Playwright needs at its own revision.
 *
 * Returns null when the site is ready, or why it is not (the audit's skip summary).
 */
export async function installSiteDeps(
  sitePath: string,
  spawn: SpawnFn,
  opts: { browser: boolean },
): Promise<string | null> {
  if (!(await exists(join(sitePath, "node_modules")))) {
    let install;
    try {
      install = await spawn("pnpm", ["install", "--frozen-lockfile"], {
        cwd: sitePath,
        timeoutMs: 5 * 60_000,
      });
    } catch (err) {
      if (/ENOENT/.test(String(err))) return "pnpm not available";
      throw err;
    }
    if (install.code !== 0) {
      const retry = await spawn("pnpm", ["install"], { cwd: sitePath, timeoutMs: 5 * 60_000 });
      if (retry.code !== 0) return `pnpm install failed (exit ${retry.code}) — deps unavailable`;
    }
  }
  if (opts.browser) {
    const browser = await spawn("pnpm", ["exec", "playwright", "install", "chromium"], {
      cwd: sitePath,
      timeoutMs: 5 * 60_000,
    });
    if (browser.code !== 0) return `playwright install chromium failed (exit ${browser.code})`;
  }
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
