// The site-level check: which files, which exemptions, and what is NEW against
// the committed baseline (P1-120 phase 2).
//
// A site carries two files at its root, both optional:
//
//   content-check.json           the site's settings: `mode` ("warn" | "fail"),
//                                `exempt` (globs), `ignore` (literals or
//                                /regex/), `fallbackHelpers` (call names)
//   content-check.baseline.json  the literals already in code when the check
//                                arrived, as counts per file, kind and text
//
// Only a literal BEYOND its baseline count is reported. Line numbers are not
// part of the key, so moving code within a file reports nothing; renaming the
// file reports its literals as new, and `--write-baseline` re-records them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { glob } from "tinyglobby";
import { builtInExemption } from "./rules.js";
import {
  ScanParseError,
  onlyFallbackUses,
  parseFile,
  scanParsed,
  type FileScan,
  type Finding,
  type Parsed,
} from "./scan.js";

export const CONFIG_FILE = "content-check.json";
export const BASELINE_FILE = "content-check.baseline.json";

export type ContentCheckConfig = {
  mode: "warn" | "fail";
  exempt: string[];
  ignore: string[];
  fallbackHelpers: string[];
};

export type Baseline = { version: 1; counts: Record<string, Record<string, number>> };

/** A settings or baseline file that cannot be read as written. Exit 2: a broken
 *  baseline that read as empty would report every literal as new, and one that
 *  read as "everything" would hide every new one. */
export class ContentCheckConfigError extends Error {
  readonly exitCode = 2;
}

const SOURCE_GLOBS = ["src/routes/**/*.{svelte,ts,js}", "src/lib/**/*.{svelte,ts,js}"];
const NEVER = [
  "**/*.d.ts",
  "**/*.{test,spec}.{ts,js}",
  "**/*.stories.{svelte,ts,js}",
  "**/+server.{ts,js}",
  "**/__tests__/**",
  "**/node_modules/**",
];

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function readConfig(cwd: string): ContentCheckConfig {
  const path = join(cwd, CONFIG_FILE);
  const config: ContentCheckConfig = { mode: "warn", exempt: [], ignore: [], fallbackHelpers: [] };
  if (!existsSync(path)) return config;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ContentCheckConfigError(`${CONFIG_FILE}: not JSON (${(err as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ContentCheckConfigError(`${CONFIG_FILE}: must be a JSON object`);
  }
  const r = raw as Record<string, unknown>;
  const known = new Set(["$comment", "mode", "exempt", "ignore", "fallbackHelpers"]);
  for (const k of Object.keys(r)) {
    if (!known.has(k)) throw new ContentCheckConfigError(`${CONFIG_FILE}: unknown key "${k}"`);
  }
  if (r.mode !== undefined) {
    if (r.mode !== "warn" && r.mode !== "fail") {
      throw new ContentCheckConfigError(`${CONFIG_FILE}: mode must be "warn" or "fail"`);
    }
    config.mode = r.mode;
  }
  for (const key of ["exempt", "ignore", "fallbackHelpers"] as const) {
    if (r[key] === undefined) continue;
    if (!isStringArray(r[key])) {
      throw new ContentCheckConfigError(`${CONFIG_FILE}: ${key} must be an array of strings`);
    }
    config[key] = r[key];
  }
  return config;
}

export function readBaseline(cwd: string): Baseline {
  const path = join(cwd, BASELINE_FILE);
  if (!existsSync(path)) return { version: 1, counts: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ContentCheckConfigError(`${BASELINE_FILE}: not JSON (${(err as Error).message})`);
  }
  const b = raw as Partial<Baseline>;
  const countsOk =
    typeof b.counts === "object" &&
    b.counts !== null &&
    Object.values(b.counts).every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        Object.values(m).every((n) => Number.isInteger(n) && (n as number) > 0),
    );
  if (b.version !== 1 || !countsOk) {
    throw new ContentCheckConfigError(
      `${BASELINE_FILE}: expected {"version": 1, "counts": {file: {"kind\\ttext": count}}}`,
    );
  }
  return b as Baseline;
}

export const baselineKey = (f: Pick<Finding, "kind" | "text">): string => `${f.kind}\t${f.text}`;

export function toBaseline(findings: readonly Finding[]): Baseline {
  const counts: Record<string, Record<string, number>> = {};
  for (const f of findings) {
    const perFile = (counts[f.file] ??= {});
    const key = baselineKey(f);
    perFile[key] = (perFile[key] ?? 0) + 1;
  }
  // Sorted, so a regenerated baseline diffs only where the code changed.
  const sorted: Record<string, Record<string, number>> = {};
  for (const file of Object.keys(counts).sort()) {
    const inner: Record<string, number> = {};
    for (const key of Object.keys(counts[file]!).sort()) inner[key] = counts[file]![key]!;
    sorted[file] = inner;
  }
  return { version: 1, counts: sorted };
}

export const serializeBaseline = (b: Baseline): string => `${JSON.stringify(b, null, 2)}\n`;

/** The findings beyond the baseline's count for their (file, kind, text). When
 *  a group has more than its baseline allows, the LAST ones in the file are
 *  the new ones: there is no telling which copy was added, and the later
 *  lines are the likelier. */
export function newFindings(findings: readonly Finding[], baseline: Baseline): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const id = `${f.file}\n${baselineKey(f)}`;
    const g = groups.get(id) ?? [];
    g.push(f);
    groups.set(id, g);
  }
  const out: Finding[] = [];
  for (const g of groups.values()) {
    const allowed = baseline.counts[g[0]!.file]?.[baselineKey(g[0]!)] ?? 0;
    out.push(...g.slice(allowed));
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Baseline entries the code no longer has: phase 3's progress, and the cue to
 *  shrink the file. Never a failure. */
export function staleCount(findings: readonly Finding[], baseline: Baseline): number {
  const have = toBaseline(findings).counts;
  let stale = 0;
  for (const [file, keys] of Object.entries(baseline.counts)) {
    for (const [key, n] of Object.entries(keys)) stale += Math.max(0, n - (have[file]?.[key] ?? 0));
  }
  return stale;
}

export type ScanResult = {
  findings: Finding[];
  files: number;
  exempt: Array<{ file: string; why: string }>;
  unparsed: string[];
};

/** The repo-relative file an import specifier names, if it is one of ours:
 *  `./x`, `../x`, `$lib/x`, with or without an extension or `/index`. */
export function resolveImport(
  from: string,
  spec: string,
  known: ReadonlySet<string>,
): string | undefined {
  let base: string;
  if (spec.startsWith("$lib/")) base = `src/lib/${spec.slice(5)}`;
  else if (spec === "$lib") base = "src/lib";
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = posix.normalize(posix.join(posix.dirname(from), spec));
  } else return undefined;
  const stem = base.replace(/\.js$/, "");
  for (const c of [
    base,
    `${stem}.ts`,
    `${stem}.js`,
    `${base}.svelte`,
    `${stem}/index.ts`,
    `${stem}/index.js`,
  ]) {
    if (known.has(c)) return c;
  }
  return undefined;
}

export async function scanSite(cwd: string, config: ContentCheckConfig): Promise<ScanResult> {
  const files = (
    await glob(SOURCE_GLOBS, { cwd, ignore: NEVER, onlyFiles: true, expandDirectories: false })
  ).sort();
  const userExempt = new Set(
    config.exempt.length
      ? await glob(config.exempt, { cwd, onlyFiles: true, expandDirectories: false })
      : [],
  );
  const result: ScanResult = { findings: [], files: 0, exempt: [], unparsed: [] };

  // Pass 1: parse every file, exempt ones included, so a call into a helper
  // defined anywhere can be resolved to its parameter names.
  const parsed = new Map<string, Parsed>();
  for (const file of files) {
    try {
      parsed.set(file, parseFile(file, readFileSync(join(cwd, file), "utf8")));
    } catch (err) {
      if (!(err instanceof ScanParseError)) throw err;
      result.unparsed.push(err.message);
    }
  }
  const known = new Set(parsed.keys());

  // Pass 2: scan the files a visitor can reach.
  const scans = new Map<string, FileScan>();
  for (const [file, p] of parsed) {
    const why = builtInExemption(file) ?? (userExempt.has(file) ? CONFIG_FILE : undefined);
    if (why) {
      result.exempt.push({ file, why });
      continue;
    }
    result.files++;
    const scan = scanParsed(p, {
      fallbackHelpers: config.fallbackHelpers,
      ignore: config.ignore,
      paramsOf: (name) => {
        const local = p.functions.get(name);
        if (local) return local;
        const imp = p.imports.get(name);
        const target = imp && resolveImport(file, imp.source, known);
        return target ? parsed.get(target)?.functions.get(imp.imported) : undefined;
      },
    });
    scans.set(file, scan);
    result.findings.push(...scan.findings);
  }

  // Pass 3: an exported constant's literals are fallbacks only when every
  // read of it, in its own file and in every scanned file that imports it,
  // is a fallback. A namespace import (`import * as copy`) cannot be followed,
  // so it counts as a plain read. Reads from exempt files do not count.
  for (const [file, scan] of scans) {
    for (const d of scan.deferred) {
      const total = { bare: 0, fallback: 0 };
      const add = (u?: { bare: number; fallback: number }): void => {
        if (!u) return;
        total.bare += u.bare;
        total.fallback += u.fallback;
      };
      add(scan.uses.get(d.binding));
      for (const [other, otherScan] of scans) {
        const p = parsed.get(other)!;
        for (const [local, imp] of p.imports) {
          if (resolveImport(other, imp.source, known) !== file) continue;
          if (imp.imported === d.binding) add(otherScan.uses.get(local));
          else if (imp.imported === "*" && otherScan.uses.has(local)) total.bare++;
        }
      }
      if (!onlyFallbackUses(total)) {
        const { binding: _b, ...finding } = d;
        result.findings.push(finding);
      }
    }
  }
  result.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return result;
}

export const writeBaselineFile = (cwd: string, findings: readonly Finding[]): void =>
  writeFileSync(join(cwd, BASELINE_FILE), serializeBaseline(toBaseline(findings)));
