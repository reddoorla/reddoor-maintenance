import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The major version of `@sveltejs/kit` a site declares in its package.json:
 * a number, null when it declares none (or has no package.json), or
 * "unreadable" when it declares a spec this cannot read (`catalog:`,
 * `workspace:*`, a git or file spec, "latest", or a range that does not pin one
 * major, such as `>=2.61.1` or `2 - 3`).
 *
 * sync-configs needs it because SvelteKit 3 changed where the config lives:
 * kit 3 refuses to start beside a `svelte.config.js` (config_file_unsupported),
 * so the kit 2 templates would break a kit 3 site, and the kit 3 ones a kit 2
 * site. The declared range, not the installed version, is what is read: sync
 * runs on checkouts that may have no node_modules, and the range is what the
 * site's own CI installs from. pnpm installs the HIGHEST version a range
 * allows, so each `||` alternative must pin one major: its lower and upper
 * bounds in the same major (`^2.61.1`, `>=3 <4`, `2.0.0 - 2.9.0`). One that is
 * open above (`>=2.61.1`, `*`) or spans two majors (`2 - 3`) reads as
 * "unreadable" (#1637): its lower bound is not what installs. A union of
 * readable alternatives (`^2.0.0 || ^3.0.0`, Renovate's widen strategy) reads
 * as its highest major, which is what pnpm installs. "unreadable" is kept
 * apart from null so callers never guess kit 2 for a site that may be on
 * kit 3.
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
  const majors = range.split("||").map(alternativeMajor);
  if (majors.some((m) => m === null)) return "unreadable";
  return Math.max(...(majors as number[]));
}

/** One comparator: an operator and a version whose minor and patch may be
 *  absent or wildcards. A wildcard major is not matched, so `*` and `x` read
 *  as no major at all. */
const COMPARATOR =
  /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The one major an `||`-free range allows, or null when it allows none it can
 *  name or more than one. */
function alternativeMajor(alternative: string): number | null {
  // `>= 2.61.1` is `>=2.61.1`, and a hyphen range is two bounds.
  const tokens = alternative
    .trim()
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
    .replace(/\s+-\s+/g, " <hyphen> ")
    .split(/\s+/)
    .filter((t) => t !== "");
  let low: number | null = null;
  let high: number | null = null;
  const raise = (m: number) => (low = low === null ? m : Math.max(low, m));
  const cap = (m: number) => (high = high === null ? m : Math.min(high, m));
  for (let i = 0; i < tokens.length; i++) {
    const hyphen = tokens[i + 1] === "<hyphen>";
    if (hyphen && tokens[i + 2] === undefined) return null;
    const match = COMPARATOR.exec(tokens[i]!);
    if (!match) return null;
    const [, op = "", majorText, minor, patch, pre] = match;
    const major = Number(majorText);
    if (hyphen) {
      // `A - B`: at least A, at most B (a partial B covers its whole major).
      if (op !== "") return null;
      raise(major);
      const upper = COMPARATOR.exec(tokens[i + 2]!);
      if (!upper || (upper[1] ?? "") !== "") return null;
      cap(Number(upper[2]));
      i += 2;
    } else if (op === ">=" || op === ">") {
      raise(major);
    } else if (op === "<=") {
      cap(major);
    } else if (op === "<") {
      // `<3`, `<3.0.0` and `<3.x` stop below kit 3. A prerelease bound
      // (`<3.0.0-next.2`) can admit 3.0.0's own prereleases, so it stays in 3.
      const atMajorStart = [minor, patch].every(
        (p) => p === undefined || p === "0" || /^[xX*]$/.test(p),
      );
      if (atMajorStart && pre === undefined) {
        if (major === 0) return null;
        cap(major - 1);
      } else cap(major);
    } else {
      // `^N`, `~N`, `N`, `N.x` and `=N` all stay inside N (`^0.x` inside 0).
      raise(major);
      cap(major);
    }
  }
  if (low === null || high === null || low !== high) return null;
  return low;
}
