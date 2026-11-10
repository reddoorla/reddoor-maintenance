#!/usr/bin/env node
// Bring `main` into `staging` on a staging-flow site, with pnpm-lock.yaml merged by pnpm
// instead of by git as text.
//
//   node scripts/staging-bring-main.mjs --dir <site checkout> [--main <ref>] [--staging <ref>]
//                                       [--branch <name>] [--no-fetch] [--pnpm "<command>"]
//
// Run it from this repo against a site's checkout (`--dir`); the site needs a full clone, not
// a shallow one, because the merge needs the merge base.
//
// Why (2026-11-03): on the staging flow, Renovate's patches and minors land on `main`, and
// lock-file maintenance and majors land on `staging`, so both branches rewrite pnpm-lock.yaml
// between promotions. Git then conflicts on the lockfile and nothing else: the 11-03 states of
// caltex-landing (non-major #104 on main, lock-file maintenance #105 on staging; 51 hunks) and
// medical-solutions-of-texas (#111 on main, #113 and #117 on staging; 31 hunks) left both the
// bring-main PR and the promotion PR dirty. GitHub could only resolve that by hand-editing the
// text, and on a bring-main PR whose head is `main` it would commit the result to `main`. This
// script is the runbook's conflict path, done the same way every time:
//
//   1. fetch the two refs (unless --no-fetch); nothing to do when `main` is already an
//      ancestor of `staging`;
//   2. in a temporary worktree at `staging`, `git merge --no-ff --no-commit main`;
//   3. a conflict in any file but the root pnpm-lock.yaml stops with exit 2: a real fork (a
//      major on `staging` against a minor of the same package on `main`), or a nested lockfile
//      this script does not handle. Either is a human's;
//   4. `pnpm install --lockfile-only --ignore-scripts` with the site's pinned pnpm (its
//      `packageManager`, through corepack; with no pin it refuses unless --pnpm is given). pnpm
//      merges the two sides of a conflicted lockfile itself ("Merge conflict detected in
//      pnpm-lock.yaml and successfully merged") and re-resolves only what the merged
//      package.json no longer matches. It runs after a clean textual merge too, because two
//      clean hunks can still leave a lockfile that disagrees with package.json;
//   5. refuse the result if a conflict marker or unmerged path is left, or if pnpm changed any
//      file but the lockfile;
//   6. check what pnpm chose, dependency by dependency, over both of pnpm 12's YAML
//      documents. For each version a side's lockfile resolved, through each importer
//      (package.json) or package that depended on it there: if the merged lockfile still has
//      that importer, or that exact package version, what it resolves the dependency to now must
//      be at least the side's version. Not a regression: a dependent the merged lockfile no
//      longer has (nothing depends on that copy now); a version the merged importer's own range
//      rejects, or an `overrides` pin (not one scoped under a parent, `a>b`) whose selector
//      covers it (a downgrade on purpose); a peer, which follows the site's own choice and is
//      checked there; versions that are not semver (`file:`, `link:`, a tarball). A version
//      with no dependent on record (no snapshots, or reached only as a peer) falls back to its line, a major or `0.minor`:
//      the newest merged version in that line must be at least the side's newest there.
//      On 2026-11-10 pnpm 12.5.1 merged alamo-anatomy's and mantis-landscaping's lockfiles
//      cleanly and still put staging's rolldown 1.3.0, cookie 2.0.2 and @netlify/types 3.3.1
//      back to main's older versions (alamo-anatomy#108, mantis-landscaping#87);
//   7. on a regression, retry the way both incidents were fixed by hand: write a side's own
//      lockfile over the merged one and run step 4 again, `staging`'s first, then `main`'s,
//      but only a side that has a lockfile and whose package.json files, patches/,
//      pnpm-workspace.yaml, .npmrc and .pnpmfile.cjs/.mjs match the merged tree's, so its
//      lockfile already answers them. The seeded result goes through steps 5 and 6 again,
//      against both sides, so a seed that drops the other side's lockfile-only change stops
//      too. A pnpm failure during a seed stops with exit 1. If no seed passes, stop with exit 2,
//      name each package put back and why each side could not seed: that lockfile is a human's;
//   8. commit it as a merge commit, so `main` is a parent and the promotion PR has nothing
//      left to merge from `main`, and create <branch> at it in the checkout.
//
// It changes nothing on GitHub. Push <branch>, open its PR into `staging`, and merge that PR
// as a merge commit on green, only while `staging`'s live tip is still the sha printed here
// (docs/runbooks/staging-flow.md, "Promotion, each time").
//
// Exit codes: 0 the branch was made, or there was nothing to bring; 2 a conflict outside the
// root pnpm-lock.yaml, or a merged lockfile that put a version back and no seed repaired
// (nothing was made); 1 any other failure (nothing was made).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { flagValue, isMain } from "./lib/cli.mjs";

export const LOCKFILE = "pnpm-lock.yaml";
const CHECKED =
  "Checked: every dependency the merged lockfile keeps (same importer, or same package " +
  "version) resolves at least as new as on either side, beyond downgrades the merged " +
  "package.json ranges or overrides ask for; peers are checked through the site's own choice, " +
  "versions with no dependent on record by their major (or 0.minor) line, and versions that " +
  "are not semver not at all.";
const USAGE =
  "usage: node scripts/staging-bring-main.mjs --dir <site checkout> [--main <ref>] [--staging <ref>]\n" +
  '                                           [--branch <name>] [--no-fetch] [--pnpm "<command>"]\n' +
  "exit: 0 made or nothing to bring, 2 a conflict outside pnpm-lock.yaml or a lockfile that put a version back, 1 error";

export function parseArgs(argv, now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const o = {
    dir: process.cwd(),
    main: "origin/main",
    staging: "origin/staging",
    branch: `claude/main-into-staging-${stamp}`,
    fetch: true,
    pnpm: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") o.dir = resolve(flagValue(argv[++i], a));
    else if (a === "--main") o.main = flagValue(argv[++i], a);
    else if (a === "--staging") o.staging = flagValue(argv[++i], a);
    else if (a === "--branch") o.branch = flagValue(argv[++i], a);
    else if (a === "--pnpm") o.pnpm = flagValue(argv[++i], a);
    else if (a === "--no-fetch") o.fetch = false;
    else throw new Error(`unknown argument: ${a}\n${USAGE}`);
  }
  return o;
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

function mustGit(cwd, args) {
  const r = git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** The pnpm to run: --pnpm as given, else the site's pinned `packageManager` through corepack. */
export function pnpmCommand(siteDir, override) {
  if (override) return override.split(/\s+/).filter(Boolean);
  let pm;
  try {
    pm = JSON.parse(readFileSync(join(siteDir, "package.json"), "utf8")).packageManager;
  } catch {
    pm = undefined;
  }
  const m = typeof pm === "string" && /^pnpm@([^+\s]+)/.exec(pm);
  if (!m)
    throw new Error(
      "package.json pins no pnpm (`packageManager`); pass --pnpm with the version CI uses, " +
        "or a different pnpm may rewrite the whole lockfile",
    );
  return ["corepack", `pnpm@${m[1]}`];
}

/** `origin/main` → ["origin", "main"] when `origin` is a remote of `dir`; anything else → null. */
function remoteBranch(ref, remotes) {
  const i = ref.indexOf("/");
  return i > 0 && remotes.includes(ref.slice(0, i)) ? [ref.slice(0, i), ref.slice(i + 1)] : null;
}

const MARKER = /^(<{7}|={7}|>{7})( |$)/m;

// The files pnpm resolves from. A side whose copies of these match the merged tree's can seed
// the lockfile: its own lockfile already answers the merged package.json.
const RESOLUTION_INPUTS = [
  ":(glob)**/package.json",
  ":(glob)patches/**",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
];

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(v) {
  const m = SEMVER.exec(v);
  return m ? { t: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : [] } : null;
}

function comparePre(a, b) {
  if (!a.length || !b.length) return (a.length ? -1 : 0) + (b.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]);
    const nb = /^\d+$/.test(b[i]);
    if (na && nb && +a[i] !== +b[i]) return +a[i] - +b[i];
    if (na !== nb) return na ? -1 : 1;
    if (!na && a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a.t[i] !== b.t[i]) return a.t[i] - b.t[i];
  return comparePre(a.pre, b.pre);
}

/** Semver precedence of two versions: negative, zero or positive. Both must be semver. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a semver version: ${pa ? b : a}`);
  return cmp(pa, pb);
}

const PART = "(\\*|x|X|\\d+)";
const COMPARATOR = new RegExp(
  `^(>=|<=|>|<|=|\\^|~>?|)v?${PART}(?:\\.${PART})?(?:\\.${PART})?(?:-([0-9A-Za-z.-]+))?(?:\\+\\S+)?$`,
);
const wild = (p) => p === undefined || p === "*" || p === "x" || p === "X";
const v3 = (a, b, c, pre = []) => ({ t: [a, b, c], pre });
const LOWEST = ["0"]; // `-0` sorts below every other prerelease of the same version

/** One comparator token → [op, version, explicit prerelease][]; [] admits anything; null unknown. */
function expand(token) {
  const m = COMPARATOR.exec(token);
  if (!m) return null;
  const op = m[1] === "~>" ? "~" : m[1];
  const [M, mi, p] = [m[2], m[3], m[4]];
  const pre = m[5] ? m[5].split(".") : [];
  if (wild(M)) return op === "<" || op === ">" ? [["<", v3(0, 0, 0, LOWEST)]] : [];
  const maj = +M;
  const min = wild(mi) ? null : +mi;
  const pat = min === null || wild(p) ? null : +p;
  const lo = v3(maj, min ?? 0, pat ?? 0, pre);
  const next = (x, y, z) => ["<", v3(x, y, z, LOWEST)];
  const upTo = min === null ? next(maj + 1, 0, 0) : next(maj, min + 1, 0);
  switch (op) {
    case "":
    case "=":
      return pat === null ? [[">=", lo], upTo] : [["=", lo, pre.length > 0]];
    case "^":
      if (maj > 0 || min === null) return [[">=", lo, pre.length > 0], next(maj + 1, 0, 0)];
      if (min > 0 || pat === null) return [[">=", lo, pre.length > 0], next(0, min + 1, 0)];
      return [[">=", lo, pre.length > 0], next(0, 0, pat + 1)];
    case "~":
      return [[">=", lo, pre.length > 0], upTo];
    case ">":
      return pat === null ? [[">=", upTo[1]]] : [[">", lo, pre.length > 0]];
    case ">=":
      return [[">=", lo, pre.length > 0]];
    case "<":
      return [["<", pat === null ? v3(maj, min ?? 0, 0, LOWEST) : lo, pre.length > 0]];
    case "<=":
      return pat === null ? [upTo] : [["<=", lo, pre.length > 0]];
  }
  return null;
}

const TEST = {
  "=": (c) => c === 0,
  ">": (c) => c > 0,
  ">=": (c) => c >= 0,
  "<": (c) => c < 0,
  "<=": (c) => c <= 0,
};

/**
 * Whether a package.json range admits a version, by npm's rules (a prerelease only where a
 * comparator names a prerelease of the same version). `undefined` when the range is not a
 * semver range this can read: `workspace:`, `catalog:`, a URL, a tag.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return undefined;
  let r = range.trim();
  if (r.startsWith("npm:")) {
    const at = r.lastIndexOf("@");
    r = at > 4 ? r.slice(at + 1) : "*";
  } else if (/^[a-z+]+:/i.test(r) || r.includes("/")) return undefined;
  let any = false;
  for (const raw of r.split("||")) {
    let set = raw.trim();
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hy) set = `>=${hy[1]} <=${hy[2]}`;
    const tokens = set
      .replace(/(>=|<=|>|<|=|\^|~>?)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    const comps = [];
    for (const t of tokens) {
      const c = expand(t);
      if (!c) return undefined;
      comps.push(...c);
    }
    if (!comps.every(([op, w]) => TEST[op](cmp(v, w)))) continue;
    if (
      v.pre.length &&
      !comps.some(([, w, explicit]) => explicit && w.t.join(".") === v.t.join("."))
    )
      continue;
    any = true;
  }
  return any;
}

const docs = (text) => yaml.loadAll(text).filter((d) => d && typeof d === "object");

/**
 * Every `name@version` in every `packages:` section of a lockfile (pnpm 12 writes two documents).
 * pnpm 8's `/name@version` keys read the same, so a side on the older format is still compared.
 */
export function lockfilePackages(text) {
  const out = new Map();
  for (const d of docs(text))
    for (const key of Object.keys(d.packages ?? {})) {
      let bare = key.includes("(") ? key.slice(0, key.indexOf("(")) : key;
      if (bare.startsWith("/")) bare = bare.slice(1);
      const at = bare.lastIndexOf("@");
      if (at <= 0) continue;
      const name = bare.slice(0, at);
      out.set(name, [...(out.get(name) ?? []), bare.slice(at + 1)]);
    }
  return out;
}

// pnpm's own parent separator: a `>` not preceded by a space, `|` or `@`, so `a>b` names a
// parent and `cookie@>=2.0.2` or `vite@>=6.0.0 <=6.1.5` is one package with a selector.
const PARENT = /[^ |@]>/;

/** `foo@<0.7.0` → [`foo`, `<0.7.0`]; `@s/foo` → [`@s/foo`, undefined]: what an override key covers. */
const overrideTarget = (key) => {
  const at = key.indexOf("@", 1);
  return at > 0 ? [key.slice(0, at), key.slice(at + 1)] : [key, undefined];
};

/** `npm:@preact/compat@^17` under `react` → true; `npm:cookie@^0.7.0` under `cookie` → false. */
const aliasOfAnother = (name, specifier) => {
  if (!specifier.startsWith("npm:")) return false;
  const rest = specifier.slice(4);
  const at = rest.indexOf("@", 1);
  return (at > 0 ? rest.slice(0, at) : rest) !== name;
};

const stripPeers = (v) => String(v).split("(")[0];

/**
 * A resolution as [package, version]: `1.2.0` under `foo` is foo's; `bar@1.2.0` under `foo` (an
 * `npm:` alias of another package, as pnpm 9 writes it) is bar's.
 */
const resolved = (key, v) => {
  const s = stripPeers(v);
  const at = s.lastIndexOf("@");
  return !parseVersion(s) && at > 0 && parseVersion(s.slice(at + 1))
    ? [s.slice(0, at), s.slice(at + 1)]
    : [key, s];
};

/** `foo@1.0.0` → [`foo`, `1.0.0`] */
const splitKey = (k) => [k.slice(0, k.lastIndexOf("@")), k.slice(k.lastIndexOf("@") + 1)];

/**
 * Who depends on what. `parents`: `name@version` → each importer (`env:<path>` in pnpm 12's
 * own first document, `project:<path>` otherwise) or package snapshot that resolved it, with
 * the `key` it sits under (an alias's own name); `importers`: importer → key → its `specifier`
 * (the package.json range, a `catalog:` one read through the lockfile's catalogs), the package
 * it resolves and its version; `deps`: package → `key\0package` → the versions its snapshot
 * resolved, keyed by the snapshot (peer variant and all) and, as `~name@version`, across all
 * its variants, peers left out; `copies`: package → the versions it has snapshots for;
 * `overrides`: each top-level override that is not scoped under a parent (`a>b` pins b only
 * under a), with the selector its key carries. Non-semver resolutions are left out.
 */
function lockfileGraph(text) {
  const g = {
    parents: new Map(),
    importers: new Map(),
    deps: new Map(),
    copies: new Map(),
    overrides: [],
  };
  const parent = (child, p) => g.parents.set(child, [...(g.parents.get(child) ?? []), p]);
  for (const d of docs(text)) {
    for (const [key, range] of Object.entries(d.overrides ?? {}))
      if (typeof range === "string" && !PARENT.test(key)) {
        const [name, selector] = overrideTarget(key);
        g.overrides.push({ name, selector, range });
      }
    // pnpm 12 writes its own env (packageManagerDependencies, configDependencies) as a first
    // document; pnpm 10 and older write the project alone. Key importers by that role, not by
    // position, so a side on either format meets the merged lockfile's project importers.
    const imps = Object.values(d.importers ?? {});
    const env =
      imps.length > 0 &&
      imps.every((imp) =>
        Object.keys(imp ?? {}).every(
          (k) => k === "packageManagerDependencies" || k === "configDependencies",
        ),
      );
    // `catalog:` and `catalog:<name>` name a range in the lockfile's own catalogs
    const catalog = (name, spec) => {
      if (typeof spec !== "string" || !spec.startsWith("catalog:")) return spec;
      const range = d.catalogs?.[spec.slice(8) || "default"]?.[name]?.specifier;
      return typeof range === "string" ? range : spec;
    };
    for (const [path, imp] of Object.entries(d.importers ?? {})) {
      const key = `${env ? "env" : "project"}:${path}`;
      const m = new Map();
      for (const group of Object.values(imp ?? {}))
        if (group && typeof group === "object")
          for (const [name, e] of Object.entries(group)) {
            if (!e || typeof e !== "object" || e.version === undefined) continue;
            const [pkg, version] = resolved(name, e.version);
            m.set(name, {
              specifier: typeof e.specifier === "string" ? catalog(name, e.specifier) : undefined,
              pkg,
              version,
            });
            if (parseVersion(version)) parent(`${pkg}@${version}`, { importer: key, key: name });
          }
      g.importers.set(key, m);
    }
    const peers = new Map();
    for (const [k, pkg] of Object.entries(d.packages ?? {}))
      peers.set(stripPeers(k).replace(/^\//, ""), Object.keys(pkg?.peerDependencies ?? {}));
    for (const [k, snap] of Object.entries(d.snapshots ?? {})) {
      const full = k.replace(/^\//, "");
      const pk = stripPeers(full);
      // a peer resolves to the copy the site chose: its importer edge checks it when the site
      // names it, and otherwise (an auto-installed peer) another edge or the line fallback does
      const own = (name) => !(peers.get(pk) ?? []).includes(name);
      // each peer variant (`foo@1.0.0(react@18.0.0)`) on its own, and all of them together
      // (`~foo@1.0.0`) for a variant the other lockfile does not have
      const exact = g.deps.get(full) ?? new Map();
      const all = g.deps.get(`~${pk}`) ?? new Map();
      const [base, baseVersion] = splitKey(pk);
      if (!(g.copies.get(base) ?? []).includes(baseVersion))
        g.copies.set(base, [...(g.copies.get(base) ?? []), baseVersion]);
      for (const group of ["dependencies", "optionalDependencies"])
        for (const [name, v] of Object.entries(snap?.[group] ?? {})) {
          const [pkg, version] = resolved(name, v);
          if (!parseVersion(version) || !own(name)) continue;
          const at = `${name}\0${pkg}`;
          exact.set(at, [...(exact.get(at) ?? []), version]);
          all.set(at, [...(all.get(at) ?? []), version]);
          parent(`${pkg}@${version}`, { snapshot: full, base: pk, key: name });
        }
      g.deps.set(full, exact);
      g.deps.set(`~${pk}`, all);
    }
  }
  return g;
}

/** A version's line: its major, or `0.minor` below 1.0.0, the versions `^` treats as one. */
const lineOf = (v) => {
  const p = parseVersion(v);
  return p ? (p.t[0] > 0 ? `${p.t[0]}` : `0.${p.t[1]}`) : undefined;
};

const newest = (vs) => vs.reduce((a, b) => (a && compareVersions(a, b) >= 0 ? a : b), undefined);
const oldest = (vs) => vs.reduce((a, b) => (a && compareVersions(a, b) <= 0 ? a : b), undefined);

/** name → line → its semver versions */
function byLine(pkgs) {
  const out = new Map();
  for (const [name, vs] of pkgs) {
    const lines = new Map();
    for (const v of vs) {
      const l = lineOf(v);
      if (l !== undefined) lines.set(l, [...(lines.get(l) ?? []), v]);
    }
    if (lines.size) out.set(name, lines);
  }
  return out;
}

/**
 * Where the merged lockfile went backwards, edge by edge. For each version a side's lockfile
 * resolved, through each importer or package that depended on it there: if the merged lockfile
 * still has that importer (same role, pnpm 12's env or the project, and path) or package
 * snapshot (the same peer variant, else all variants of that `name@version`), what it resolves
 * the name to now must be at least the side's version. A dependent the merged lockfile no
 * longer has says nothing (nothing depends on that copy now: `cssesc` once
 * `postcss-selector-parser` 7.2.0 dropped it). Not a regression either: a version the merged
 * importer's own range rejects (P1-106 moved `@types/node` from 25 to 24 on purpose; an `npm:`
 * alias of another package does not count), or one an override (not scoped under a parent) whose selector
 * covers it pins lower. Peer edges are skipped: a peer follows the site's own choice, which its
 * importer edge checks. A version with no dependent on record (a lockfile with no snapshots, or
 * a version reached only as a peer) falls back to its line, a major or `0.minor`: the newest
 * merged version in the line must be at least the side's newest there, and a line the merged
 * lockfile no longer has is gone. Versions that are not semver (`file:`, `link:`, a tarball)
 * are not compared.
 * @param {string} merged
 * @param {Record<string, string | undefined>} sides
 */
export function lockfileRegressions(merged, sides) {
  const now = byLine(lockfilePackages(merged));
  const m = lockfileGraph(merged);
  const out = new Map();
  for (const [side, text] of Object.entries(sides)) {
    if (text === undefined) continue;
    const g = lockfileGraph(text);
    for (const [name, lines] of byLine(lockfilePackages(text)))
      for (const [line, vs] of lines) {
        const top = newest(vs);
        for (const had of vs) {
          const ps = g.parents.get(`${name}@${had}`) ?? [];
          let lower;
          for (const p of ps) {
            let to;
            if (p.importer) {
              // under the key the side held it by: `foo: npm:bar@^1` is bar's edge, held by foo
              const e = m.importers.get(p.importer)?.get(p.key);
              if (!e || e.pkg !== name || !parseVersion(e.version)) continue;
              // an `npm:` alias of another package (`react: npm:@preact/compat@^17`) ranges over
              // that package, so it excuses nothing here; `cookie: npm:cookie@^0.7.0` is cookie's own
              if (
                e.specifier !== undefined &&
                !aliasOfAnother(name, e.specifier) &&
                satisfies(had, e.specifier) === false
              )
                continue;
              to = e.version;
            } else {
              const at = `${p.key}\0${name}`;
              let got = m.deps.get(p.snapshot)?.get(at) ?? m.deps.get(`~${p.base}`)?.get(at);
              if (!got) {
                // the dependent itself moved up its line (main's Renovate took foo 1.0.0 to
                // 1.0.1): each newer copy in that line must still resolve the name as new
                const [dep, depVersion] = splitKey(p.base);
                got = (m.copies.get(dep) ?? [])
                  .filter(
                    (v) => lineOf(v) === lineOf(depVersion) && compareVersions(v, depVersion) > 0,
                  )
                  .flatMap((v) => m.deps.get(`~${dep}@${v}`)?.get(at) ?? []);
                if (!got.length) continue;
              }
              // the lowest: a variant that kept the side's version must not hide one that did not
              to = oldest(got);
            }
            if (compareVersions(to, had) < 0 && (!lower || compareVersions(to, lower) < 0))
              lower = to;
          }
          if (!ps.length && had === top) {
            const got = now.get(name)?.get(line);
            const best = got && newest(got);
            if (best && compareVersions(best, had) < 0) lower = best;
          }
          if (!lower) continue;
          const pinned = m.overrides.some(
            (o) =>
              o.name === name &&
              (o.selector === undefined || satisfies(had, o.selector) === true) &&
              satisfies(had, o.range) === false,
          );
          if (!pinned) out.set(`${side}\0${name}\0${had}`, { name, side, had, merged: lower });
        }
      }
  }
  return [...out.values()].sort((a, b) =>
    a.name < b.name
      ? -1
      : a.name > b.name
        ? 1
        : a.side !== b.side
          ? a.side < b.side
            ? -1
            : 1
          : compareVersions(a.had, b.had),
  );
}

/** `cookie 2.0.2 (staging) -> 2.0.1, …`, cut to `limit` entries with a count of the rest. */
export function describeRegressions(rs, limit = Infinity) {
  const shown = rs.slice(0, limit).map((r) => `${r.name} ${r.had} (${r.side}) -> ${r.merged}`);
  return shown.join(", ") + (rs.length > limit ? `, and ${rs.length - limit} more` : "");
}

/**
 * @returns {import("./staging-bring-main.d.mts").Result}
 */
export function bringMain(o) {
  if (mustGit(o.dir, ["rev-parse", "--is-shallow-repository"]) === "true")
    throw new Error(
      `${o.dir} is a shallow clone, so the merge base may be missing; run \`git fetch --unshallow\` there first`,
    );
  if (o.fetch) {
    const remotes = mustGit(o.dir, ["remote"]).split("\n");
    for (const ref of [o.main, o.staging]) {
      const rb = remoteBranch(ref, remotes);
      if (!rb)
        throw new Error(`cannot fetch ${ref}: name it as <remote>/<branch>, or pass --no-fetch`);
      mustGit(o.dir, ["fetch", "-q", rb[0], `+refs/heads/${rb[1]}:refs/remotes/${ref}`]);
    }
  }
  // After a fetch, read the remote-tracking ref itself: a local branch named `origin/main` would shadow it.
  const full = (ref) => (o.fetch ? `refs/remotes/${ref}` : ref);
  const main = mustGit(o.dir, ["rev-parse", "--verify", `${full(o.main)}^{commit}`]);
  const staging = mustGit(o.dir, ["rev-parse", "--verify", `${full(o.staging)}^{commit}`]);
  if (git(o.dir, ["merge-base", "--is-ancestor", main, staging]).code === 0)
    return { status: "up-to-date" };
  if (git(o.dir, ["rev-parse", "--verify", "-q", `refs/heads/${o.branch}`]).code === 0)
    throw new Error(`branch ${o.branch} already exists`);

  const tmp = mkdtempSync(join(tmpdir(), "bring-main-"));
  const wt = join(tmp, "wt");
  try {
    // Inside the try: a `worktree add` that fails part-way (a hook, a lazy blob fetch cut off)
    // still leaves a registered worktree, which the finally removes.
    mustGit(o.dir, ["worktree", "add", "-q", "--detach", wt, staging]);
    const merged = git(wt, ["merge", "--no-ff", "--no-commit", main]);
    const unmerged = () =>
      git(wt, ["diff", "--name-only", "--diff-filter=U"]).stdout.split("\n").filter(Boolean);
    const conflicted = unmerged();
    const others = conflicted.filter((f) => f !== LOCKFILE);
    if (others.length) {
      git(wt, ["merge", "--abort"]);
      return { status: "conflict", files: others };
    }
    if (merged.code !== 0 && conflicted.length === 0)
      throw new Error(`git merge failed: ${merged.stderr || merged.stdout}`);

    let regressions = [];
    let seededFrom = null;
    const hasLockfile = existsSync(join(wt, LOCKFILE));
    if (hasLockfile) {
      const [cmd, ...pre] = pnpmCommand(wt, o.pnpm);
      const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
      const args = [
        ...pre,
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--no-frozen-lockfile",
      ];
      const regenerate = () => {
        const r = spawnSync(cmd, args, { cwd: wt, env, encoding: "utf8" });
        if (r.error)
          throw new Error(
            `${cmd} could not run: ${r.error.message}` +
              (r.error.code === "ENOENT" && cmd === "corepack" && pre[0]?.startsWith("pnpm@")
                ? `. Node 25 and later ship no corepack: \`npm i -g corepack\`, or pass --pnpm "npx pnpm@${pre[0]?.slice(5)}"`
                : ""),
          );
        if (r.status !== 0)
          throw new Error(
            `${[cmd, ...args].join(" ")} failed (${r.status ?? r.signal}):\n${r.stderr || r.stdout}`,
          );
        const text = readFileSync(join(wt, LOCKFILE), "utf8");
        if (MARKER.test(text))
          throw new Error(
            `${LOCKFILE} still has conflict markers after ${[cmd, ...pre].join(" ")} install`,
          );
        mustGit(wt, ["add", LOCKFILE]);
        const stray = [
          ...git(wt, ["diff", "--name-only"]).stdout.split("\n"),
          ...git(wt, ["ls-files", "--others", "--exclude-standard"]).stdout.split("\n"),
        ].filter(Boolean);
        if (stray.length)
          throw new Error(`pnpm changed files besides ${LOCKFILE}: ${stray.join(", ")}`);
        return text;
      };
      // Untrimmed and unbounded, unlike git(): a seed is written back byte for byte.
      const show = (sha) => {
        const r = spawnSync("git", ["show", `${sha}:${LOCKFILE}`], {
          cwd: wt,
          encoding: "utf8",
          maxBuffer: 256 * 1024 * 1024,
        });
        return r.status === 0 ? r.stdout : undefined;
      };
      const sides = { main: show(main), staging: show(staging) };
      // pnpm's merge can be clean and still wrong: on 2026-11-10 it put three of staging's
      // lock-file-maintenance versions back to main's older ones (alamo-anatomy#108).
      regressions = lockfileRegressions(regenerate(), sides);
      if (regressions.length) {
        // Retry from a side's own lockfile, as both incidents did by hand, but only a side whose
        // resolution inputs the merged tree still has: its lockfile already answers them.
        const seeds = [];
        const skipped = [];
        for (const [side, sha] of [
          ["staging", staging],
          ["main", main],
        ]) {
          if (sides[side] === undefined) {
            skipped.push({ side, reason: `${side} has no ${LOCKFILE}` });
            continue;
          }
          if (
            git(wt, ["diff", "--cached", "--quiet", sha, "--", ...RESOLUTION_INPUTS]).code !== 0
          ) {
            skipped.push({
              side,
              reason: `the merged package.json files (or patches/, pnpm-workspace.yaml, .npmrc, .pnpmfile) are not ${side}'s`,
            });
            continue;
          }
          writeFileSync(join(wt, LOCKFILE), sides[side]);
          const rs = lockfileRegressions(regenerate(), sides);
          seeds.push({ side, regressions: rs });
          if (!rs.length) {
            seededFrom = side;
            break;
          }
        }
        if (!seededFrom) {
          git(wt, ["merge", "--abort"]);
          return { status: "regressed", regressions, seeds, skipped };
        }
      }
    }
    const left = unmerged();
    if (left.length) throw new Error(`still unmerged: ${left.join(", ")}`);

    const how = seededFrom
      ? `pnpm's merge of ${LOCKFILE} put back ${describeRegressions(regressions)}, so it was ` +
        `seeded from ${seededFrom}'s ${LOCKFILE} instead and passed through \`pnpm install --lockfile-only\`. ` +
        CHECKED
      : conflicted.includes(LOCKFILE)
        ? `${LOCKFILE} conflicted, and pnpm merged it (\`pnpm install --lockfile-only\`), not a hand edit. ` +
          CHECKED
        : hasLockfile
          ? `${LOCKFILE} merged as text, then went through \`pnpm install --lockfile-only\`. ` +
            CHECKED
          : `No ${LOCKFILE}, so nothing to merge or check.`;
    mustGit(wt, [
      "commit",
      "-q",
      "--no-verify",
      "-m",
      "Merge main into staging",
      "-m",
      `main ${main.slice(0, 7)} into staging ${staging.slice(0, 7)}, by scripts/staging-bring-main.mjs ` +
        `(reddoorla/reddoor-maintenance). ${how}`,
    ]);
    const sha = mustGit(wt, ["rev-parse", "HEAD"]);
    mustGit(o.dir, ["branch", o.branch, sha]);
    return {
      status: "made",
      branch: o.branch,
      sha,
      main,
      staging,
      lockfileConflicted: conflicted.includes(LOCKFILE),
      regressions,
      seededFrom,
    };
  } finally {
    git(o.dir, ["worktree", "remove", "--force", wt]);
    rmSync(tmp, { recursive: true, force: true });
    // Only when this run's own entry survived the remove (a part-way `worktree add`): a bare
    // prune would also drop other worktrees whose directories are missing for now.
    if (
      git(o.dir, ["worktree", "list", "--porcelain"]).stdout.split("\n").includes(`worktree ${wt}`)
    )
      git(o.dir, ["worktree", "prune"]);
  }
}

if (isMain(import.meta.url)) {
  let code = 1;
  try {
    const o = parseArgs(process.argv.slice(2));
    const short = o.staging.replace(/^refs\/remotes\//, "");
    const remote = short.includes("/") ? short.slice(0, short.indexOf("/")) : "origin";
    const r = bringMain(o);
    if (r.status === "up-to-date") {
      console.log("nothing to bring: main is already an ancestor of staging");
      code = 0;
    } else if (r.status === "conflict") {
      console.error(
        `stopped: main and staging conflict outside the root ${LOCKFILE}, in ${r.files.join(", ")}. ` +
          "That is a real fork or a nested lockfile, not the lockfile race; nothing was made.",
      );
      code = 2;
    } else if (r.status === "regressed") {
      const tried = [
        ...r.seeds.map(
          (x) =>
            `Seeded from ${x.side}'s lockfile instead, it put back ${describeRegressions(x.regressions)}.`,
        ),
        ...r.skipped.map((x) => `Not seeded from ${x.side}'s lockfile: ${x.reason}.`),
      ].join(" ");
      console.error(
        `stopped: pnpm's merge of ${LOCKFILE} put back versions a side already had: ` +
          `${describeRegressions(r.regressions)}. ${tried} Nothing was made; this lockfile is a human's ` +
          '(docs/runbooks/staging-flow.md, "Promotion, each time").',
      );
      code = 2;
    } else {
      console.log(
        `made ${r.branch} at ${r.sha.slice(0, 7)}: main ${r.main.slice(0, 7)} into staging ${r.staging}` +
          (r.seededFrom
            ? `, ${LOCKFILE} seeded from ${r.seededFrom}'s because pnpm's merge put back ${describeRegressions(r.regressions, 3)}`
            : r.lockfileConflicted
              ? `, ${LOCKFILE} conflicted and merged by pnpm`
              : `, ${LOCKFILE} merged as text and passed through pnpm`),
      );
      console.log(
        `next: git push ${remote} ${r.branch}; open its PR into staging; merge it on green as a merge commit, ` +
          `never a squash, and only while staging's live tip (GET branches/staging) is still ${r.staging}; ` +
          "if it has moved, close the PR and run this again",
      );
      code = 0;
    }
  } catch (e) {
    console.error(`staging-bring-main: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exitCode = code;
}
