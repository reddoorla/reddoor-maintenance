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

/**
 * The eligible caps a parsed preset sets. A rule counts only when its sole
 * matcher is `matchPackageNames` naming the package exactly: a rule narrowed by
 * manager, file or anything else is not a fleet-wide hold. Renovate applies
 * rules in order, so the last matching rule wins.
 */
export function capsFromPreset(
  preset: unknown,
  eligible: readonly string[] = HELD_CAP_PACKAGES,
): Map<string, string> {
  const caps = new Map<string, string>();
  if (!isObject(preset) || !Array.isArray(preset["packageRules"])) return caps;
  for (const rule of preset["packageRules"] as unknown[]) {
    if (!isObject(rule)) continue;
    const matchers = Object.keys(rule).filter(
      (k) => k.startsWith("match") || k.startsWith("exclude"),
    );
    if (matchers.length !== 1 || matchers[0] !== "matchPackageNames") continue;
    const names = rule["matchPackageNames"];
    const allowed = rule["allowedVersions"];
    if (!Array.isArray(names)) continue;
    for (const pkg of eligible) {
      if (!names.includes(pkg)) continue;
      if (typeof allowed === "string") caps.set(pkg, allowed);
      // A later rule naming the package without a cap does not lift an earlier one
      // in Renovate (options merge), so it is ignored here too.
    }
  }
  return caps;
}

/** Fetch the org preset's text; null on any failure. */
export type PresetReader = () => Promise<string | null>;

export const fetchOrgPreset: PresetReader = async () => {
  try {
    const res = await fetch(ORG_PRESET_URL, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};

let memo: { reader: PresetReader; caps: Promise<Map<string, string> | null> } | null = null;

/** The preset's eligible caps, read once per process per reader; null when unread. */
export function orgPresetCaps(
  reader: PresetReader = fetchOrgPreset,
): Promise<Map<string, string> | null> {
  if (memo?.reader !== reader) {
    memo = {
      reader,
      caps: reader().then((text) => {
        if (text === null) return null;
        try {
          return capsFromPreset(parseRenovateConfigText(text));
        } catch {
          return null;
        }
      }),
    };
  }
  return memo.caps;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** True when the site's own Renovate config (the first file Renovate would
 *  read) extends the org preset directly. */
export async function siteExtendsOrgPreset(sitePath: string): Promise<boolean> {
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
      return false;
    }
    if (file === "package.json" && config === undefined) continue;
    if (!isObject(config)) return false;
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
  return false;
}

/** The major a version spec pins, or null when it does not pin exactly one:
 *  `24`, `v24.1.0`, `24.x`, `^24.0.0`, `~24.2`. A range like `>=24` admits 25
 *  too, so it pins nothing. */
export function pinnedMajor(spec: string): number | null {
  const m = /^[\^~]?v?(\d+)(?:\.(?:\d+|x|\*)){0,2}$/.exec(spec.trim());
  return m ? Number.parseInt(m[1]!, 10) : null;
}

/** The site's Node runtime major: `.nvmrc` first, `engines.node` as the
 *  fallback when `.nvmrc` is missing or names no single major. */
export async function siteNodeMajor(sitePath: string): Promise<number | null> {
  const nvmrc = await readText(join(sitePath, ".nvmrc"));
  if (nvmrc !== null) {
    const major = pinnedMajor(nvmrc);
    if (major !== null) return major;
  }
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
  // The preset is fetched only for a site that extends it.
  if (!(await siteExtendsOrgPreset(sitePath))) return { caps: new Map(), nodeMajor };
  return { caps: (await orgPresetCaps(reader)) ?? new Map(), nodeMajor };
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
