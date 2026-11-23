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
  JSON_BINDING,
  ScanParseError,
  compileIgnore,
  onlyFallbackUses,
  parseFile,
  scanParsed,
  type FileScan,
  type Finding,
  type Parsed,
  type Usage,
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

const SOURCE_GLOBS = ["src/routes/**/*.{svelte,ts,js,json}", "src/lib/**/*.{svelte,ts,js,json}"];
const NEVER = [
  "**/*.d.ts",
  "**/*.{test,spec}.{ts,js}",
  "**/*.stories.{svelte,ts,js}",
  "**/+server.{ts,js}",
  "**/__tests__/**",
  // Test and dev fixtures: data a test or a /dev page feeds a component,
  // never shown on the site (review round 2: reddoor-website's
  // report/fixtures, roalson's and MSOT's *-fixture.ts).
  "**/fixtures/**",
  "**/*{-,.}fixture.{ts,js}",
  "**/*{-,.}fixtures.{ts,js}",
  "**/node_modules/**",
];

/** SvelteKit's route files: `+page.svelte`, `+layout.ts`, `+error.svelte`, … */
const ROUTE_FILE = /(?:^|\/)\+[^/]+$/;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function readConfig(cwd: string): ContentCheckConfig {
  const path = join(cwd, CONFIG_FILE);
  const config: ContentCheckConfig = { mode: "warn", exempt: [], ignore: [], fallbackHelpers: [] };
  if (!existsSync(path)) return config;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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
  // A bad pattern found here is exit 2; found mid-scan it would be a crash
  // (exit 1) that turns a warn-mode site's CI red.
  for (const entry of config.ignore) {
    try {
      compileIgnore(entry);
    } catch (err) {
      throw new ContentCheckConfigError(`${CONFIG_FILE}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }
  return config;
}

export function readBaseline(cwd: string): Baseline {
  const path = join(cwd, BASELINE_FILE);
  if (!existsSync(path)) return { version: 1, counts: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new ContentCheckConfigError(`${BASELINE_FILE}: not JSON (${(err as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ContentCheckConfigError(`${BASELINE_FILE}: must be a JSON object`);
  }
  const b = raw as Partial<Baseline>;
  const isMap = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
  const countsOk =
    isMap(b.counts) &&
    Object.values(b.counts!).every(
      (m) => isMap(m) && Object.values(m).every((n) => Number.isInteger(n) && (n as number) > 0),
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
  /** `exempt` entries that matched no file, as written: a silent no-op
   *  otherwise (review round 6). */
  unmatchedExempt: string[];
};

/** The aliases `createKitConfig` gives every site (`src/configs/svelte.ts`),
 *  beside SvelteKit's own `$lib` (review round 6). */
const KIT_ALIASES: Record<string, string> = {
  $lib: "src/lib",
  $components: "src/lib/components",
  $utils: "src/lib/utils",
  $stores: "src/lib/stores",
  $assets: "src/lib/assets",
};

/** A glob's `[ ] ( )` taken literally: `src/routes/[[preview=preview]]/(marketing)/**`
 *  as a site's routes are written, not as a character class and a group. A
 *  backslash is escaped too, so the result is the entry, literally (CodeQL). */
const escapeRouteChars = (g: string): string => g.replace(/[\\[\]()]/g, "\\$&");

/** Does a site's error page show `error()`'s message? SvelteKit's default
 *  page does, so a site with no `+error.svelte` does too; erp-industrial's
 *  and roalson's show only the status (review round 6). */
const SHOWS_ERROR_MESSAGE = /\berror\??\.message\b|\$page\.error\b/;

/** The repo-relative file an import specifier names, if it is one of ours:
 *  `./x`, `../x`, `$lib/x`, with or without an extension or `/index`. */
export function resolveImport(
  from: string,
  spec: string,
  known: ReadonlySet<string>,
): string | undefined {
  let base: string | undefined;
  const alias = spec.split("/")[0]!;
  if (KIT_ALIASES[alias] !== undefined) base = KIT_ALIASES[alias] + spec.slice(alias.length);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = posix.normalize(posix.join(posix.dirname(from), spec));
  }
  if (base === undefined) return undefined;
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

/** Where an imported name is defined: the file it names, or, when that file
 *  is a barrel (`export { SITE } from "./site"`, `export * from "./site"`),
 *  the file the barrel passes it on from, one hop. Every candidate is listed:
 *  a `*` re-export may or may not be where the name comes from. */
export function importOrigins(
  from: string,
  imp: { source: string; imported: string },
  parsed: ReadonlyMap<string, Parsed>,
  known: ReadonlySet<string>,
): Array<{ file: string; name: string }> {
  const target = resolveImport(from, imp.source, known);
  if (!target) return [];
  const out = [{ file: target, name: imp.imported }];
  for (const re of parsed.get(target)?.reexports ?? []) {
    const all = imp.imported === "*";
    if (!all && re.exported !== imp.imported && re.exported !== "*") continue;
    const next = resolveImport(target, re.source, known);
    const name = all ? "*" : re.imported === "*" ? imp.imported : re.imported;
    if (next) out.push({ file: next, name });
  }
  return out;
}

export async function scanSite(cwd: string, config: ContentCheckConfig): Promise<ScanResult> {
  const files = (
    await glob(SOURCE_GLOBS, { cwd, ignore: NEVER, onlyFiles: true, expandDirectories: false })
  ).sort();
  const result: ScanResult = {
    findings: [],
    files: 0,
    exempt: [],
    unparsed: [],
    unmatchedExempt: [],
  };
  // Each entry on its own, so one that matches nothing can be named; one
  // that matches nothing as a glob is tried again with `[ ] ( )` literal.
  const userExempt = new Set<string>();
  for (const entry of config.exempt) {
    const opts = { cwd, onlyFiles: true, expandDirectories: false };
    let hits = await glob([entry], opts);
    if (hits.length === 0) hits = await glob([escapeRouteChars(entry)], opts);
    if (hits.length === 0) result.unmatchedExempt.push(entry);
    for (const h of hits) userExempt.add(h);
  }

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

  // A file only exempt files import is out of a visitor's reach too: seed data
  // that only a /dev route and scripts/ read (review round 4 on #2231: 506
  // rows of williamson's and beachfront's site-pages.js). A file no scanned
  // file imports is still scanned: it may be read some way this cannot see.
  const exemptions = new Map<string, string>();
  for (const file of parsed.keys()) {
    const why = builtInExemption(file) ?? (userExempt.has(file) ? CONFIG_FILE : undefined);
    if (why) exemptions.set(file, why);
  }
  const importers = new Map<string, Set<string>>();
  for (const [file, p] of parsed) {
    const specs = [
      ...[...p.imports.values()].map((i) => i.source),
      ...p.reexports.map((r) => r.source),
    ];
    for (const spec of specs) {
      const target = resolveImport(file, spec, known);
      if (target && target !== file)
        (importers.get(target) ?? importers.set(target, new Set()).get(target)!).add(file);
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [file, from] of importers) {
      // A route file is reached by its URL, whoever imports it.
      if (exemptions.has(file) || ROUTE_FILE.test(file)) continue;
      if (![...from].every((f) => exemptions.has(f))) continue;
      exemptions.set(file, "only exempt files import it");
      changed = true;
    }
  }

  const errorPages = files.filter(
    (f) => f.startsWith("src/routes/") && f.endsWith("/+error.svelte"),
  );
  const kitErrorShown =
    errorPages.length === 0 ||
    errorPages.some((f) => SHOWS_ERROR_MESSAGE.test(readFileSync(join(cwd, f), "utf8")));

  // Pass 2: scan the files a visitor can reach.
  const scans = new Map<string, FileScan>();
  for (const [file, p] of parsed) {
    // A `.json` file counts only when a file imports it (`site-config.json`);
    // Slice Machine's model.json and mocks.json are read by tools, not pages.
    if (file.endsWith(".json") && !importers.has(file)) continue;
    const why = exemptions.get(file);
    if (why) {
      result.exempt.push({ file, why });
      continue;
    }
    result.files++;
    const scan = scanParsed(p, {
      fallbackHelpers: config.fallbackHelpers,
      ignore: config.ignore,
      kitErrorShown,
      paramsOf: (name) => {
        const local = p.functions.get(name);
        if (local) return local;
        const imp = p.imports.get(name);
        if (!imp) return undefined;
        for (const o of importOrigins(file, imp, parsed, known)) {
          const params = parsed.get(o.file)?.functions.get(o.name);
          if (params) return params;
        }
        return undefined;
      },
    });
    scans.set(file, scan);
    result.findings.push(...scan.findings);
  }

  const onlyExemptRead = (file: string, name: string): boolean => {
    let readers = 0;
    for (const [other, p] of parsed) {
      for (const imp of p.imports.values()) {
        const hit = importOrigins(other, imp, parsed, known).some(
          (o) =>
            o.file === file &&
            (o.name === name || o.name === "*" || (o.name === "default" && name === JSON_BINDING)),
        );
        if (!hit) continue;
        if (!exemptions.has(other)) return false;
        readers++;
      }
    }
    return readers > 0;
  };

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
      // Read only by exempt files (MSOT's PRIVACY_VALUES, read by the privacy
      // copy): as far from a visitor as they are.
      if (!scan.uses.has(d.binding) && onlyExemptRead(file, d.binding)) continue;
      for (const [other, otherScan] of scans) {
        const p = parsed.get(other)!;
        for (const [local, imp] of p.imports) {
          for (const o of importOrigins(other, imp, parsed, known)) {
            if (o.file !== file) continue;
            const name = o.name === "default" && file.endsWith(".json") ? JSON_BINDING : o.name;
            if (name === d.binding) add(otherScan.uses.get(local));
            else if (o.name === "*" && otherScan.uses.has(local)) total.bare++;
            break;
          }
        }
      }
      if (!onlyFallbackUses(total)) {
        const { binding: _b, ...finding } = d;
        result.findings.push(finding);
      }
    }
  }
  // Pass 4: a component's prop default, or a literal behind `prop || "…"`, is
  // a fallback only when every place a scanned file renders the component
  // passes that prop (or spreads props it cannot see into).
  // With no call site, or one that leaves it out, the default is what shows.
  for (const [file, scan] of scans) {
    if (scan.props.length === 0) continue;
    const calls: Usage[] = [];
    for (const [other, otherScan] of scans) {
      const p = parsed.get(other)!;
      for (const [local, imp] of p.imports) {
        const here = importOrigins(other, imp, parsed, known).some(
          (o) => o.file === file && o.name === "default",
        );
        if (!here) continue;
        calls.push(...p.usages.filter((u) => u.name === local));
        // `<svelte:component this={Hero} />`, `const C = Hero`: a read of the
        // name anywhere but as a tag renders it with props this pass cannot
        // see, so it counts as a call site that passes nothing.
        if (otherScan.uses.has(local)) calls.push({ name: local, attrs: [], spread: false });
      }
    }
    for (const { prop, ...finding } of scan.props) {
      const names = typeof prop === "string" ? [prop] : prop;
      const always =
        calls.length > 0 && calls.every((u) => u.spread || names.some((n) => u.attrs.includes(n)));
      if (!always) result.findings.push(finding);
    }
  }
  result.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return result;
}

export const writeBaselineFile = (cwd: string, findings: readonly Finding[]): void =>
  writeFileSync(join(cwd, BASELINE_FILE), serializeBaseline(toBaseline(findings)));
