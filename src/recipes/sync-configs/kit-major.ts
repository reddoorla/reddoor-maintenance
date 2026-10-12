import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The major version of `@sveltejs/kit` a site declares in its package.json:
 * a number, null when it declares none (or has no package.json), or
 * "unreadable" when it declares a spec this cannot read (`catalog:`,
 * `workspace:*`, a git or file spec, "latest").
 *
 * sync-configs needs it because SvelteKit 3 changed where the config lives:
 * kit 3 refuses to start beside a `svelte.config.js` (config_file_unsupported),
 * so the kit 2 templates would break a kit 3 site, and the kit 3 ones a kit 2
 * site. The declared range, not the installed version, is what is read: sync
 * runs on checkouts that may have no node_modules, and the range is what the
 * site's own CI installs from. A union (`^2.0.0 || ^3.0.0`, Renovate's widen
 * strategy) reads as its highest major, which is what pnpm installs.
 * "unreadable" is kept apart from null so callers never guess kit 2 for a site
 * that may be on kit 3.
 */
export async function readKitMajor(cwd: string): Promise<number | null | "unreadable"> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8"));
  } catch {
    return null;
  }
  const spec = pkg.devDependencies?.["@sveltejs/kit"] ?? pkg.dependencies?.["@sveltejs/kit"];
  if (typeof spec !== "string") return null;
  // `npm:@sveltejs/kit@^3.0.0` aliases: read the range after the last `@`.
  const range = spec.startsWith("npm:") ? spec.slice(spec.lastIndexOf("@") + 1) : spec;
  const majors = range.split("||").map((part) => {
    const match = /^\s*(?:[\^~]|>=?|=)?\s*v?(\d+)(?:[.\s]|$)/.exec(part);
    return match ? Number(match[1]) : null;
  });
  if (majors.some((m) => m === null)) return "unreadable";
  return Math.max(...(majors as number[]));
}
