/**
 * Which branches does Renovate MERGE INTO on a repo? (#892)
 *
 * The protection sweep judged the DEFAULT branch, but Renovate merges into
 * whatever `baseBranchPatterns` names (`baseBranches` before Renovate renamed
 * it). Measured 2026-09-21 across the 30 non-archived `reddoorla` repos, one
 * differed: reddoor-website, `"baseBranchPatterns": ["staging"]`, whose
 * `staging` carried a deletion-only ruleset — so nothing required CI on the
 * branch Renovate was actually merging into, and nothing watched it.
 *
 * This module only answers the question. The verdict (is each base branch
 * CI-gated?) lives in protection-coverage.ts beside the default-branch floor.
 *
 * Three answers, and the third is what keeps the sweep honest:
 *  - `default-only`: no Renovate config at all, or one that names no base
 *    branch. Renovate targets the default branch, which the ruleset floor
 *    already judges — so this is NEVER a gap. It is the fleet's normal shape
 *    (27 of 30 repos extend the org preset and set no base branch).
 *  - `configured`: the patterns, plus where they came from.
 *  - `unverified`: the repo's OWN config could not be read or interpreted.
 *    That is not "no base branches", and it is not "an unprotected base
 *    branch" either — the caller reports it in the sweep's existing
 *    "(unverified, not clean)" wording, never as a finding about a branch it
 *    could not see. It adds no newly-gapped repo: a refused contents read
 *    already gaps the same repo through the pnpm-pin sweep's package.json read.
 *
 * A PRESET that cannot be read or parsed is different, and is NOT unverified.
 * 27 repos extend one org preset, so treating its refusal as unverified would
 * turn one refused read into 27 gap rows on the tracking issue — the first live
 * run of this module, from a session that could not see `reddoorla/.github`,
 * did exactly that to reddoor-maintenance. A preset is followed only when it
 * is resolvable; one that is not is skipped and NAMED in `unreadPresets`, which
 * the caller prints on the row as a non-gating note. Visible every night,
 * never an alarm, and the repo's own config — where a base branch is actually
 * set, as on reddoor-website — is still judged in full.
 *
 * Config is read at the DEFAULT branch, which is where Renovate reads its repo
 * config and therefore `baseBranchPatterns` from. A base branch carrying no
 * renovate.json of its own is the normal case and changes nothing here.
 */

/** Renovate's own config-file search order (lib/config/app-strings.ts); the
 *  FIRST file present wins and the rest are never read, exactly as Renovate
 *  does. `package.json` counts only when it carries a `renovate` key. */
export const RENOVATE_CONFIG_FILES = [
  "renovate.json",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".gitlab/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
  "package.json",
] as const;

/** How deep a chain of `extends` is followed before a preset is skipped as
 *  unresolvable (and named in `unreadPresets`). */
export const PRESET_DEPTH_LIMIT = 5;

export type RenovateBaseBranchDeps = {
  /** A text file at a repo's DEFAULT branch, `null` when absent (an answer);
   *  any other failure throws (see GitHub.repoTextFile). */
  repoTextFile: (repo: string, path: string) => Promise<string | null>;
};

export type RenovateBaseBranches =
  | { state: "default-only"; reason: string; unreadPresets: string[] }
  | {
      state: "configured";
      /** e.g. `baseBranchPatterns in renovate.json`, or `… in github>org/repo:name`. */
      source: string;
      patterns: string[];
      unreadPresets: string[];
    }
  | { state: "unverified"; reason: string };

type ConfigObject = Record<string, unknown>;

function isObject(v: unknown): v is ConfigObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The JSON5 that Renovate configs actually use — `//` and block comments,
 * single-quoted strings, bare identifier keys, trailing commas — rewritten as
 * JSON. Deliberately a subset (no hex, no leading `+`, no multi-line strings):
 * anything outside it fails the JSON.parse that follows and reads as
 * unverified, never as "no base branches".
 */
export function json5ToJson(text: string): string {
  const n = text.length;
  const skipTrivia = (from: number): number => {
    let i = from;
    for (;;) {
      while (i < n && /\s/.test(text[i]!)) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
      } else if (text[i] === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end < 0) throw new Error("unterminated block comment");
        i = end + 2;
      } else return i;
    }
  };
  let out = "";
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      let body = "";
      let j = i + 1;
      for (; j < n && text[j] !== c; j++) {
        const ch = text[j]!;
        if (ch === "\\") {
          const next = text[j + 1] ?? "";
          body += c === "'" && next === "'" ? "'" : ch + next;
          j++;
        } else body += c === "'" && ch === '"' ? '\\"' : ch;
      }
      if (j >= n) throw new Error("unterminated string");
      out += `"${body}"`;
      i = j + 1;
    } else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      i = skipTrivia(i);
      out += " ";
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(text[j]!)) j++;
      const word = text.slice(i, j);
      out += text[skipTrivia(j)] === ":" ? `"${word}"` : word;
      i = j;
    } else if (c === ",") {
      const next = text[skipTrivia(i + 1)];
      if (next !== "}" && next !== "]") out += ",";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Parse a Renovate config file: strict JSON first, then the JSON5 subset. */
export function parseRenovateConfigText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(json5ToJson(text));
  }
}

/**
 * Where a preset's file lives, or `null` when this audit cannot resolve it.
 *
 * Resolvable: `github>` and `local>` presets without a `#tag` or sub-preset —
 * read at the preset repo's default branch, with Renovate's file naming
 * (`default.json` then `renovate.json` for a bare repo, `<name>.json` for
 * `:name`, `<path>.json` for `//path`). Everything else is skipped: Renovate's
 * built-in presets (`config:recommended`, `group:allNonMajor`, …) never set a
 * base branch, and a tagged, npm-hosted or other-platform preset is out of
 * reach of a default-branch reader. That is a known blind spot, not a silent
 * pass on what we could read.
 */
export function presetFiles(preset: string): { repo: string; files: string[] } | null {
  const m =
    /^(?:github|local)>([^/\s:#()]+\/[^/\s:#()]+)(?:\/\/([^\s:#()]+)|:([^\s/:#()]+))?(?:\(.*\))?$/.exec(
      preset,
    );
  if (!m) return null;
  const [, repo, path, name] = m;
  const withExt = (f: string) => (/\.json5?$/.test(f) ? f : `${f}.json`);
  if (path) return { repo: repo!, files: [withExt(path)] };
  if (name && name !== "default") return { repo: repo!, files: [withExt(name)] };
  return { repo: repo!, files: ["default.json", "renovate.json"] };
}

function ownBaseBranches(
  config: ConfigObject,
  where: string,
): { source: string; patterns: string[] } | null {
  // baseBranchPatterns first: it is the current name, and Renovate migrates
  // the old one into it.
  for (const key of ["baseBranchPatterns", "baseBranches"]) {
    if (config[key] === undefined) continue;
    const v = config[key];
    if (!Array.isArray(v) || !v.every((p) => typeof p === "string"))
      throw new Error(`${key} in ${where} is not a list of strings`);
    return { source: `${key} in ${where}`, patterns: v as string[] };
  }
  return null;
}

/** The repo's own value wins; otherwise the LAST preset in `extends` that sets
 *  one (Renovate merges presets in order, and a list option replaces rather
 *  than concatenates), following each preset's own `extends` in turn. A
 *  preset that cannot be read, parsed or interpreted is skipped and recorded
 *  in `unread` — never thrown, so it can never make the repo unverified (see
 *  the module comment for why). */
async function resolveBaseBranches(
  config: ConfigObject,
  where: string,
  deps: RenovateBaseBranchDeps,
  depth: number,
  seen: Set<string>,
  unread: string[],
): Promise<{ source: string; patterns: string[] } | null> {
  const own = ownBaseBranches(config, where);
  if (own) return own;
  const ext = config["extends"];
  const presets = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext : [];
  for (const preset of [...presets].reverse()) {
    if (typeof preset !== "string") continue;
    const loc = presetFiles(preset);
    if (!loc) continue;
    const key = `${loc.repo}:${loc.files.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (depth >= PRESET_DEPTH_LIMIT)
        throw new Error(`preset chain deeper than ${PRESET_DEPTH_LIMIT}`);
      let text: string | null = null;
      for (const f of loc.files) {
        text = await deps.repoTextFile(loc.repo, f);
        if (text !== null) break;
      }
      // A preset that is not there fails Renovate's own config validation, so
      // nothing merges under that config — no base branch to judge.
      if (text === null) continue;
      const parsed = parseRenovateConfigText(text);
      if (!isObject(parsed)) throw new Error("not a JSON object");
      const found = await resolveBaseBranches(parsed, preset, deps, depth + 1, seen, unread);
      if (found) return found;
    } catch (e) {
      unread.push(`${preset} (${shortReason(e)})`);
    }
  }
  return null;
}

/** The status code when there is one, else the first line, capped: a note is
 *  printed on every affected row, and the proxy's 403 body is 300 characters. */
function shortReason(e: unknown): string {
  const text = errText(e);
  const status = /HTTP \d{3}/.exec(text);
  return status ? status[0] : (text.split("\n")[0] ?? "").slice(0, 120);
}

export async function readRenovateBaseBranches(
  repo: string,
  deps: RenovateBaseBranchDeps,
): Promise<RenovateBaseBranches> {
  try {
    for (const file of RENOVATE_CONFIG_FILES) {
      const text = await deps.repoTextFile(repo, file);
      if (text === null) continue;
      let config: unknown;
      if (file === "package.json") {
        // Only a `renovate` key makes package.json a Renovate config. An
        // unparseable package.json is the pnpm-pin sweep's finding, not ours.
        try {
          config = (JSON.parse(text) as Record<string, unknown>)?.["renovate"];
        } catch {
          continue;
        }
        if (config === undefined) continue;
      } else {
        try {
          config = parseRenovateConfigText(text);
        } catch (e) {
          return { state: "unverified", reason: `${file} could not be parsed: ${errText(e)}` };
        }
      }
      if (!isObject(config)) return { state: "unverified", reason: `${file} is not a JSON object` };
      const unreadPresets: string[] = [];
      const found = await resolveBaseBranches(config, file, deps, 0, new Set(), unreadPresets);
      return found
        ? { state: "configured", ...found, unreadPresets }
        : { state: "default-only", reason: `${file} names no base branch`, unreadPresets };
    }
    return { state: "default-only", reason: "no Renovate config file", unreadPresets: [] };
  } catch (e) {
    return { state: "unverified", reason: errText(e) };
  }
}

/** A `baseBranchPatterns` entry that is a regex (`/…/`, `/…/i`, `!/…/`) or a
 *  glob rather than a branch name. Expanding one needs the repo's branch list;
 *  until something does, the caller reports it as unverified. */
export function isBranchPattern(entry: string): boolean {
  return /^!?\/.*\/i?$/.test(entry) || /[*?[\]{}!()]/.test(entry);
}
