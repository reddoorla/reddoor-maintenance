import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Read the @reddoorla/maintenance package version, given the directory of a
 * file that lives inside the package. Walks UP looking for the first
 * `package.json` whose `name` matches. Defensive against bundling-layout
 * changes — the older "two levels up" assumption held for `dist/cli/bin.js`
 * but would silently mis-read (or return "unknown") if tsup ever moved bin
 * to a different depth. Same walk-up pattern as the self-version helper.
 *
 * Returns "unknown" when no matching package.json is reachable (Yarn PnP
 * setups stash manifests inside .zip caches; the readFileSync there fails
 * before any name check).
 */
export function resolvePackageVersion(fromDir: string): string {
  try {
    let dir = fromDir;
    while (true) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const raw = readFileSync(candidate, "utf-8");
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === "@reddoorla/maintenance") {
          return pkg.version ?? "unknown";
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return "unknown";
      dir = parent;
    }
  } catch {
    return "unknown";
  }
}
