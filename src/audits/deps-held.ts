import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SpawnFn } from "./util/spawn.js";
import {
  RENOVATE_CONFIG_FILES,
  parseRenovateConfigText,
  presetFiles,
} from "./renovate-base-branches.js";

/**
 * P1-98: majors the fleet holds on purpose. A package a major behind is "held",
 * not "behind", only for one of two reasons, and nothing else:
 *
 *  1. A Renovate `allowedVersions` cap in the org preset
 *     (`reddoorla/.github` `renovate-config.json`) that keeps `latest` out, while
 *     the site already runs the newest major the cap allows. The preset is READ
 *     at audit time (once per process), never mirrored here, so a cap lifted in
 *     the preset stops holding on the next night with no change in this repo.
 *     Only packages in {@link HELD_CAP_PACKAGES} are eligible: the preset caps
 *     others too, and whether each is a deliberate hold is the operator's call.
 *  2. `@types/node` whose installed major equals the site's own Node runtime
 *     major (`.nvmrc`, else `engines.node`). Type definitions follow the runtime
 *     (decisions/2026-11-04-1736-erp-majors-base-and-node26.md 2(a)).
 *
 * Unknown is never a pass: an unread preset, a site that does not extend it, a
 * cap this module cannot evaluate, or an unreadable runtime leaves the package
 * counted as behind.
 */

/** The org preset the fleet's sites extend. */
export const ORG_PRESET = { repo: "reddoorla/.github", file: "renovate-config.json" } as const;
export const ORG_PRESET_URL = `https://raw.githubusercontent.com/${ORG_PRESET.repo}/HEAD/${ORG_PRESET.file}`;

/** Packages whose preset `allowedVersions` cap counts as a hold. The preset also
 *  caps `@libsql/client` and `cookie` (11-04); those stay counted until the
 *  operator says they are deliberate holds. */
export const HELD_CAP_PACKAGES: readonly string[] = ["typescript"];

/** What the deps audit needs to decide a hold, per site. */
export type HoldRules = {
  /** package → the preset's `allowedVersions`, for eligible packages the site's
   *  preset caps. Empty when the preset is unread or the site does not extend it. */
  caps: ReadonlyMap<string, string>;
  /** The site's Node runtime major; null when it cannot be read. */
  nodeMajor: number | null;
};

export const NO_HOLDS: HoldRules = { caps: new Map(), nodeMajor: null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A string in a matcher that is a glob or regex, not an exact name. */
function isPattern(v: unknown): boolean {
  return typeof v === "string" && (v.startsWith("/") || v.startsWith("!") || /[*?{]/.test(v));
}

/** True when a rule could reach `pkg` through any matcher: an exact name in any
 *  `match*`/`exclude*` list, or a glob/regex in a name matcher. */
function mentions(rule: Record<string, unknown>, pkg: string): boolean {
  return Object.entries(rule).some(
    ([k, v]) =>
      (k.startsWith("match") || k.startsWith("exclude")) &&
      Array.isArray(v) &&
      v.some((x) => x === pkg || (/PackageNames|DepNames/.test(k) && isPattern(x))),
  );
}

/**
 * The eligible caps a list of Renovate `packageRules` leaves in force, applied in
 * order as Renovate does (the org preset's, then the site's own): the last rule
 * that sets `allowedVersions` for a package wins. A rule counts as a cap only when
 * its sole matcher is `matchPackageNames` naming the package exactly. Any other
 * rule with `allowedVersions` that could reach the package (another matcher, a
 * glob or regex, an exclusion) makes its cap unknown, so the package is dropped
 * and stays counted. A rule with no `allowedVersions` lifts nothing.
 */
export function capsFromRules(
  rules: readonly unknown[],
  eligible: readonly string[] = HELD_CAP_PACKAGES,
): Map<string, string> {
  const caps = new Map<string, string>();
  for (const rule of rules) {
    if (!isObject(rule) || rule["allowedVersions"] === undefined) continue;
    const allowed = rule["allowedVersions"];
    const matchers = Object.keys(rule).filter(
      (k) => k.startsWith("match") || k.startsWith("exclude"),
    );
    const names = rule["matchPackageNames"];
    const clean =
      matchers.length === 1 &&
      matchers[0] === "matchPackageNames" &&
      Array.isArray(names) &&
      !names.some(isPattern) &&
      typeof allowed === "string";
    for (const pkg of eligible) {
      if (!mentions(rule, pkg)) continue;
      if (clean && (names as unknown[]).includes(pkg)) caps.set(pkg, allowed as string);
      else caps.delete(pkg);
    }
  }
  return caps;
}

/** The `packageRules` of a parsed Renovate config, or [] when it has none. */
export function packageRulesOf(config: unknown): unknown[] {
  return isObject(config) && Array.isArray(config["packageRules"])
    ? (config["packageRules"] as unknown[])
    : [];
}

/** The eligible caps a parsed preset sets on its own (no site rules). */
export function capsFromPreset(
  preset: unknown,
  eligible: readonly string[] = HELD_CAP_PACKAGES,
): Map<string, string> {
  return capsFromRules(packageRulesOf(preset), eligible);
}

/** Fetch the org preset's text; null on any failure. */
export type PresetReader = () => Promise<string | null>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Three tries, 2 s then 4 s apart: one failed fetch would otherwise put every
 *  site's held package back in Watch for the night. */
export const fetchOrgPreset: PresetReader = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2_000 * attempt);
    try {
      const res = await fetch(ORG_PRESET_URL, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return await res.text();
    } catch {
      // try again
    }
  }
  return null;
};

let memo: { reader: PresetReader; preset: unknown } | null = null;

/** The parsed org preset, read once per process per reader; null when unread.
 *  Only a successful read is kept, so a failure is retried for the next site. */
export async function orgPreset(reader: PresetReader = fetchOrgPreset): Promise<unknown> {
  if (memo?.reader === reader) return memo.preset;
  let text: string | null;
  try {
    text = await reader();
  } catch {
    text = null;
  }
  if (text === null) return null;
  let preset: unknown;
  try {
    preset = parseRenovateConfigText(text);
  } catch {
    return null;
  }
  if (!isObject(preset)) return null;
  memo = { reader, preset };
  return preset;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** The site's own Renovate config, from the first file Renovate would read;
 *  null when there is none or it cannot be parsed. */
export async function siteRenovateConfig(
  sitePath: string,
): Promise<Record<string, unknown> | null> {
  for (const file of RENOVATE_CONFIG_FILES) {
    const text = await readText(join(sitePath, file));
    if (text === null) continue;
    let config: unknown;
    try {
      config =
        file === "package.json"
          ? (JSON.parse(text) as Record<string, unknown>)?.["renovate"]
          : parseRenovateConfigText(text);
    } catch {
      // An unparseable package.json is not a Renovate config; any other file is
      // the one Renovate reads, and it fails, so nothing is known.
      if (file === "package.json") continue;
      return null;
    }
    if (file === "package.json" && config === undefined) continue;
    return isObject(config) ? config : null;
  }
  return null;
}

/** True when a site config extends the org preset directly. */
export function extendsOrgPreset(config: Record<string, unknown>): boolean {
  const ext = config["extends"];
  const presets = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext : [];
  return presets.some((p) => {
    if (typeof p !== "string") return false;
    const loc = presetFiles(p);
    return (
      loc.kind === "file" &&
      loc.repo.toLowerCase() === ORG_PRESET.repo &&
      loc.files.length === 1 &&
      loc.files[0] === ORG_PRESET.file
    );
  });
}

/** The major a version spec pins, or null when it does not pin exactly one:
 *  `24`, `v24.1.0`, `24.x`, `^24.0.0`, `~24.2`. A range like `>=24` admits 25
 *  too, so it pins nothing. */
export function pinnedMajor(spec: string): number | null {
  const m = /^[\^~]?v?(\d+)(?:\.(?:\d+|x|\*)){0,2}$/.exec(spec.trim());
  return m ? Number.parseInt(m[1]!, 10) : null;
}

/** The site's Node runtime major: `.nvmrc` first, `engines.node` only when
 *  `.nvmrc` is missing or blank. An `.nvmrc` that names an alias (`lts/*`,
 *  `node`) or a range still decides the runtime, so it reads as unknown. */
export async function siteNodeMajor(sitePath: string): Promise<number | null> {
  const nvmrc = await readText(join(sitePath, ".nvmrc"));
  if (nvmrc !== null && nvmrc.trim() !== "") return pinnedMajor(nvmrc);
  const pkg = await readText(join(sitePath, "package.json"));
  if (pkg === null) return null;
  try {
    const engines = (JSON.parse(pkg) as { engines?: { node?: unknown } }).engines;
    return typeof engines?.node === "string" ? pinnedMajor(engines.node) : null;
  } catch {
    return null;
  }
}

/** Everything {@link scanOutdated} needs to decide holds for one site. */
export async function loadHoldRules(
  sitePath: string,
  reader: PresetReader = fetchOrgPreset,
): Promise<HoldRules> {
  const nodeMajor = await siteNodeMajor(sitePath);
  const site = await siteRenovateConfig(sitePath);
  // The preset is fetched only for a site that extends it.
  if (site === null || !extendsOrgPreset(site)) return { caps: new Map(), nodeMajor };
  const preset = await orgPreset(reader);
  if (preset === null) {
    console.warn(`DEPS_PRESET_UNREAD ${ORG_PRESET_URL}: capped packages count as behind tonight`);
    return { caps: new Map(), nodeMajor };
  }
  // Renovate applies the preset's rules, then the site's own: a site rule can lift a cap.
  return {
    caps: capsFromRules([...packageRulesOf(preset), ...packageRulesOf(site)]),
    nodeMajor,
  };
}

export function majorOf(version: string): number {
  const head = version.replace(/^[\^~]/, "").split(".")[0] ?? "0";
  const n = Number.parseInt(head, 10);
  return Number.isNaN(n) ? 0 : n;
}

function compareVersions(a: string, b: string): number {
  const pa = a
    .split("-")[0]!
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .split("-")[0]!
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The newest published version inside `range`, from the registry via
 *  `pnpm view` (npm semver, the versioning Renovate applies to an npm range).
 *  Null on any failure, or for a regex `allowedVersions`, which this does not
 *  evaluate. */
export async function newestAllowed(
  pkg: string,
  range: string,
  sitePath: string,
  spawn: SpawnFn,
): Promise<string | null> {
  if (range.startsWith("/") || range.startsWith("!/")) return null;
  try {
    const res = await spawn("pnpm", ["view", `${pkg}@${range}`, "version", "--json"], {
      cwd: sitePath,
      timeoutMs: 30_000,
    });
    if (res.code !== 0) return null;
    const parsed = JSON.parse(res.stdout || "null") as unknown;
    const versions = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (v): v is string => typeof v === "string" && /^\d+\.\d+\.\d+/.test(v),
    );
    if (versions.length === 0) return null;
    return versions.sort(compareVersions).at(-1)!;
  } catch {
    return null;
  }
}

/** Why a package a major behind is held, or null when it is really behind. */
export async function holdReason(
  pkg: string,
  current: string,
  latest: string,
  rules: HoldRules,
  sitePath: string,
  spawn: SpawnFn,
): Promise<string | null> {
  if (pkg === "@types/node") {
    return rules.nodeMajor !== null && majorOf(current) === rules.nodeMajor
      ? `runtime Node ${rules.nodeMajor}`
      : null;
  }
  const range = rules.caps.get(pkg);
  if (range === undefined) return null;
  const top = await newestAllowed(pkg, range, sitePath, spawn);
  if (top === null) return null;
  // `latest` is outside the cap, and the site is on the newest major it allows.
  return compareVersions(top, latest.replace(/^[\^~]/, "")) < 0 && majorOf(top) === majorOf(current)
    ? `allowedVersions ${range}`
    : null;
}
