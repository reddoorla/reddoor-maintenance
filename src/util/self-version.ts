import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Read this package's own version at runtime so recipe defaults don't go
 * stale at each minor bump.
 *
 * Pass `import.meta.url` from the calling file. Walks two levels up to find
 * the package.json (works for both `src/X/Y.ts` during tests and
 * `dist/X/Y.js` in published consumers — both are two directories deep
 * under the package root).
 *
 * Returns "0.0.0" if unreachable (defensive fallback; callers should treat
 * that as a signal to either override explicitly or fail loudly).
 */
export function selfPackageVersion(callerImportMetaUrl: string): string {
  try {
    const here = dirname(fileURLToPath(callerImportMetaUrl));
    const raw = readFileSync(join(here, "..", "..", "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Caret-pinned range against this package's own version: e.g. "^0.6.2". */
export function selfCaretRange(callerImportMetaUrl: string): string {
  return `^${selfPackageVersion(callerImportMetaUrl)}`;
}
