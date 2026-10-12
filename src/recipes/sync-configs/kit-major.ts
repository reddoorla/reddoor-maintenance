import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The major version of `@sveltejs/kit` a site declares in its package.json,
 * or null when it declares none or a range this cannot read ("latest", a
 * workspace or git spec).
 *
 * sync-configs needs it because SvelteKit 3 changed where the config lives:
 * kit 3 refuses to start beside a `svelte.config.js` (config_file_unsupported),
 * so the kit 2 templates would break a kit 3 site, and the kit 3 ones a kit 2
 * site. The declared range, not the installed version, is what is read: sync
 * runs on checkouts that may have no node_modules, and the range is what the
 * site's own CI installs from. null keeps the kit 2 behaviour, which is what
 * every site had before kit 3 existed.
 */
export async function readKitMajor(cwd: string): Promise<number | null> {
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
  const match = /^\s*(?:[\^~]|>=?|=)?\s*v?(\d+)(?:\.|\s*$)/.exec(range);
  return match ? Number(match[1]) : null;
}
