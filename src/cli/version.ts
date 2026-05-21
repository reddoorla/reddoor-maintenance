import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read the package version from the package.json two levels above the given
 * directory (i.e. from `dist/cli/` → package root). Returns "unknown" if the
 * file isn't reachable (Yarn PnP setups stash manifests inside .zip caches)
 * or doesn't parse.
 */
export function resolvePackageVersion(fromDir: string): string {
  try {
    const raw = readFileSync(join(fromDir, "..", "..", "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
