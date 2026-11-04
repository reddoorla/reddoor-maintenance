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

/** The org preset the fleet's sites extend, and the repo whose presets are read. */
export const ORG_PRESET = { repo: "reddoorla/.github", file: "renovate-config.json" } as const;
export const presetUrl = (file: string): string =>
  `https://raw.githubusercontent.com/${ORG_PRESET.repo}/HEAD/${file}`;

/** Packages whose preset `allowedVersions` cap counts as a hold. The preset also
 *  caps `@libsql/client` and `cookie` (11-04); those stay counted until the
 *  operator says they are deliberate holds. */
export const HELD_CAP_PACKAGES: readonly string[] = ["typescript"];

/** What the deps audit needs to decide a hold, per site. */
export type HoldRules = {
  /** package → the `allowedVersions` in force, for eligible packages whose cap is
   *  known. Empty when any rule Renovate applies to the site cannot be read. */
  caps: ReadonlyMap<string, string>;
  /** The site's Node runtime major; null when it cannot be read. */
  nodeMajor: number | null;
};

export const NO_HOLDS: HoldRules = { caps: new Map(), nodeMajor: null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A matcher entry that is a glob, regex or negation, not an exact name. */
function isPattern(v: unknown): boolean {
  // An allowlist, not a list of glob characters: Renovate's minimatch also takes
  // extglobs (`@(typescript|eslint)`, `+(…)`), so only a string shaped like an npm
  // package name is an exact name. Anything else may reach any package.
  return typeof v !== "string" || !NPM_NAME.test(v);
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

const NAME_LISTS = ["matchPackageNames", "matchDepNames"] as const;

/**
 * Legacy `packageRules` keys Renovate migrates before matching
 * (`lib/config/migrations/custom/package-rules-migration.ts`, 44.0.0): its
 * `renameMap` turns the first group into `match*` keys, and `mergeMatchers` folds
 * the second into `matchPackageNames`/`matchDepNames` as OR'd globs, regexes or
 * negations. So a rule holding any of them is neither a clean cap nor provably
 * about other packages: `{matchPackageNames:["eslint"], matchPackagePatterns:["^type"]}`
 * reaches `typescript`, and `{matchPackageNames:["typescript"], paths:[…]}` caps
 * one file only.
 */
const LEGACY_KEYS: ReadonlySet<string> = new Set([
  // renameMap
  "matchFiles",
  "matchPaths",
  "paths",
  "languages",
  "matchLanguages",
  "baseBranchList",
  "managers",
  "datasources",
  "depTypeList",
  "packageNames",
  "packagePatterns",
  "sourceUrlPrefixes",
  "updateTypes",
  // mergeMatchers
  "matchPackagePatterns",
  "matchPackagePrefixes",
  "matchDepPatterns",
  "matchDepPrefixes",
  "matchSourceUrlPrefixes",
  "excludePackageNames",
  "excludePackagePatterns",
  "excludePackagePrefixes",
  "excludeDepNames",
  "excludeDepPatterns",
  "excludeDepPrefixes",
  "excludeRepositories",
]);

function hasLegacyKey(rule: Record<string, unknown>): boolean {
  return Object.keys(rule).some((k) => LEGACY_KEYS.has(k));
}

/** Renovate matches package and dep names case-insensitively (minimatch
 *  `nocase` in `lib/util/string-match.ts`). */
function namesInclude(list: readonly unknown[], pkg: string): boolean {
  const want = pkg.toLowerCase();
  return list.some((v) => typeof v === "string" && v.toLowerCase() === want);
}

/** True when the rule cannot apply to `pkg`: it carries an exact-name list
 *  (`matchPackageNames` or `matchDepNames`, which Renovate ANDs with its other
 *  matchers) of plain names, none of them `pkg` in any case, and no legacy key
 *  Renovate would merge into that list. Any other rule might reach it. */
function excludes(rule: Record<string, unknown>, pkg: string): boolean {
  if (hasLegacyKey(rule)) return false;
  return NAME_LISTS.some((k) => {
    const v = rule[k];
    return Array.isArray(v) && v.length > 0 && !v.some(isPattern) && !namesInclude(v, pkg);
  });
}

/**
 * The eligible caps a list of Renovate `packageRules` leaves in force, applied in
 * the order Renovate applies them: the last rule that sets `allowedVersions` for a
 * package wins. A rule is a cap only when its sole matcher is `matchPackageNames`
 * naming the package exactly. Any other rule with `allowedVersions` that is not
 * provably about other packages (by {@link excludes}) makes the cap unknown, so
 * the package is dropped and counted: a `matchDepTypes`, `matchManagers`,
 * pattern, prefix, exclusion or matcherless rule can each lift it.
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
    for (const pkg of eligible) {
      if (excludes(rule, pkg)) continue;
      const clean =
        !hasLegacyKey(rule) &&
        matchers.length === 1 &&
        matchers[0] === "matchPackageNames" &&
        Array.isArray(names) &&
        !names.some(isPattern) &&
        names.includes(pkg) &&
        typeof allowed === "string";
      if (clean) caps.set(pkg, allowed);
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

/** The eligible caps a parsed preset sets on its own (no other rules). */
export function capsFromPreset(
  preset: unknown,
  eligible: readonly string[] = HELD_CAP_PACKAGES,
): Map<string, string> {
  return capsFromRules(packageRulesOf(preset), eligible);
}

/** Fetch a preset file from `reddoorla/.github` by its path; null on failure. */
export type PresetReader = (file: string) => Promise<string | null>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Three tries, 2 s then 4 s apart: one failed fetch would otherwise put every
 *  site's held package back in Watch for the night. */
export const fetchOrgPreset: PresetReader = async (file) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2_000 * attempt);
    try {
      const res = await fetch(presetUrl(file), { signal: AbortSignal.timeout(15_000) });
      if (res.ok) return await res.text();
    } catch {
      // try again
    }
  }
  return null;
};

const memo = new WeakMap<PresetReader, Map<string, Promise<unknown>>>();

/** A preset file, parsed, read once per process per reader (a failure too: the
 *  reader has already retried, and the next site would only wait again); null
 *  when unread. The first failure prints one `DEPS_PRESET_UNREAD` line. */
export function orgPreset(
  reader: PresetReader = fetchOrgPreset,
  file: string = ORG_PRESET.file,
): Promise<unknown> {
  let files = memo.get(reader);
  if (!files) memo.set(reader, (files = new Map()));
  let p = files.get(file);
  if (!p) {
    p = (async () => {
      let text: string | null;
      try {
        text = await reader(file);
      } catch {
        text = null;
      }
      let preset: unknown = null;
      try {
        if (text !== null) preset = parseRenovateConfigText(text);
      } catch {
        preset = null;
      }
      if (!isObject(preset)) {
        console.warn(
          `DEPS_PRESET_UNREAD ${presetUrl(file)}: capped packages count as behind this run`,
        );
        return null;
      }
      return preset;
    })();
    files.set(file, p);
  }
  return p;
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

function extendsList(config: Record<string, unknown>): unknown[] {
  const ext = config["extends"];
  return typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext : [];
}

/** True when a site config extends the org preset directly. */
export function extendsOrgPreset(config: Record<string, unknown>): boolean {
  return extendsList(config).some((p) => {
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

/** A config whose rules this module cannot follow: `ignorePresets` (which drops
 *  presets it would otherwise read) or `packageRules` nested under a manager or
 *  any other key. */
function unfollowable(config: Record<string, unknown>): boolean {
  if (config["ignorePresets"] !== undefined) return true;
  if (Object.keys(config).some((k) => LEGACY_RULE_KEYS.has(k))) return true;
  // Renovate resolves `extends` in every nested object (a manager block, a single
  // packageRule) and merges `packageRules` from them; none of that is read here.
  return Object.entries(config).some(([k, v]) =>
    k === "extends"
      ? false
      : k === "packageRules" && Array.isArray(v)
        ? v.some((rule) => nests(rule, NESTED_KEYS))
        : nests(v, NESTED_KEYS),
  );
}

/** Top-level keys Renovate 44's migrations turn into `packageRules`
 *  (`PackagesMigration`, `PathRulesMigration`, `DepTypesMigration`,
 *  `PackageNameMigration`, `PackagePatternMigration`, `PackageFilesMigration`). */
const LEGACY_RULE_KEYS: ReadonlySet<string> = new Set([
  "packages",
  "pathRules",
  "depTypes",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "engines",
  "packageName",
  "packagePattern",
  "packageFiles",
]);

const NESTED_KEYS: ReadonlySet<string> = new Set(["extends", "ignorePresets", "packageRules"]);

/** True when `v`, or any object or array inside it, carries one of `keys`. */
function nests(v: unknown, keys: ReadonlySet<string>, depth = 0): boolean {
  if (depth > 20) return true;
  if (Array.isArray(v)) return v.some((x) => nests(x, keys, depth + 1));
  if (!isObject(v)) return false;
  return Object.entries(v).some(([k, x]) => keys.has(k) || nests(x, keys, depth + 1));
}

const PRESET_DEPTH = 5;

/**
 * Every `packageRules` entry Renovate applies to a config, in its order: each
 * preset in `extends` (its own `extends` first), then the config's own rules.
 * Built-in presets (`config:`, `helpers:`, `group:` …) are skipped; a preset in
 * `reddoorla/.github` is read; anything else, or anything unreadable, returns
 * null, because a rule it might hold is unknown.
 */
export async function rulesInOrder(
  config: Record<string, unknown>,
  reader: PresetReader,
  depth = 0,
): Promise<unknown[] | null> {
  if (depth > PRESET_DEPTH || unfollowable(config)) return null;
  const rules: unknown[] = [];
  for (const p of extendsList(config)) {
    if (typeof p !== "string") return null;
    const loc = presetFiles(p);
    if (loc.kind === "builtin") continue;
    if (loc.kind !== "file" || loc.repo.toLowerCase() !== ORG_PRESET.repo) return null;
    if (loc.files.length !== 1) return null;
    const preset = await orgPreset(reader, loc.files[0]);
    if (!isObject(preset)) return null;
    const inner = await rulesInOrder(preset, reader, depth + 1);
    if (inner === null) return null;
    rules.push(...inner);
  }
  rules.push(...packageRulesOf(config));
  return rules;
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
  // Presets are fetched only for a site that extends the org preset.
  if (site === null || !extendsOrgPreset(site)) return { caps: new Map(), nodeMajor };
  const rules = await rulesInOrder(site, reader);
  return { caps: rules === null ? new Map() : capsFromRules(rules), nodeMajor };
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
