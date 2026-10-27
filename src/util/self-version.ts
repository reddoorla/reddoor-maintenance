import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Read this package's own version at runtime so recipe defaults don't go
 * stale at each minor bump.
 *
 * Pass `import.meta.url` from the calling file. Walks UP from the caller
 * looking for the first `package.json` whose `name` matches this package
 * (`@reddoorla/maintenance`). The older "two levels up" shortcut held for
 * `src/X/Y.ts` and `dist/cli/bin.js` (both happen to be 2 dirs deep) but
 * broke for `dist/index.js` (only 1 dir deep) — silently returned "0.0.0"
 * and pinned consumers to `^0.0.0`. Same bug class as the 0.10.1 bundled-
 * assets ENOENT (2026-05-27). Walk-up is robust regardless of bundling
 * layout.
 *
 * Returns "0.0.0" if no matching package.json is reachable (defensive
 * fallback; callers should treat that as a signal to either override
 * explicitly or fail loudly).
 */
export function selfPackageVersion(callerImportMetaUrl: string): string {
  try {
    let dir = dirname(fileURLToPath(callerImportMetaUrl));
    while (true) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const raw = readFileSync(candidate, "utf-8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        // Only accept OUR package.json — keep walking past random ancestor
        // package.jsons (the consumer's own, anything in node_modules) that
        // happen to sit above the bundle.
        if (pkg.name === "@reddoorla/maintenance") {
          return pkg.version ?? "0.0.0";
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return "0.0.0";
      dir = parent;
    }
  } catch {
    return "0.0.0";
  }
}

/** Caret-pinned range against this package's own version: e.g. "^0.6.2". */
export function selfCaretRange(callerImportMetaUrl: string): string {
  return `^${selfPackageVersion(callerImportMetaUrl)}`;
}
