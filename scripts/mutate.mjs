#!/usr/bin/env node
// Runs a PR's named mutations from a sidecar file and prints the table its body pastes.
// P1-33 next-6 (#1596): every table before this was hand-built, and 9 harness failures in
// 13 days came from that (an applier that applied nothing, a sed that never matched,
// mutants left in a shared worktree). The rules below each answer one of those.
//
//   node scripts/mutate.mjs tests/<area>/<name>.mutations.json [--only id,id] [--in-place]
//
// Exit codes: 0 every mutant as expected, 1 some mutant not as expected, 2 refused before
// any mutant was applied, 3 stopped by an error mid-run (the results so far are printed),
// 129/130/143 stopped by SIGHUP/SIGINT/SIGTERM after restoring.
//
// A sidecar is a JSON array of {id, edits:[{file, find, replace}], test, build?, expect, why?}.
// `file` is relative to the repo root, `test` is one vitest file path or an array of them,
// `build: true` runs `pnpm run build` after the edits (for tests that spawn dist/), and
// `expect` is "red" or "survives" ("survives" needs a `why`).
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { flagValue, isMain } from "./lib/cli.mjs";

const USAGE =
  "usage: node scripts/mutate.mjs <sidecar.json> [--only id,id] [--check] [--in-place] [--timeout-ms 600000] [--json]\n" +
  "  --check validates the sidecar and every find against HEAD, then exits without running\n" +
  "exit: 0 all as expected, 1 a mutant not as expected, 2 refused, 3 error mid-run";

export const DEFAULT_TIMEOUT_MS = 600_000;

export function parseArgs(argv) {
  const o = {
    sidecar: undefined,
    only: undefined,
    inPlace: false,
    check: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => flagValue(argv[++i], a);
    if (a === "--only")
      o.only = next()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--in-place") o.inPlace = true;
    else if (a === "--check") o.check = true;
    else if (a === "--json") o.json = true;
    else if (a === "--timeout-ms") {
      const v = Number(next());
      if (!Number.isInteger(v) || v <= 0) throw new Error(`${a} needs a positive whole number`);
      o.timeoutMs = v;
    } else if (a.startsWith("--")) throw new Error(`unknown argument: ${a}`);
    else if (o.sidecar === undefined) o.sidecar = a;
    else throw new Error(`one sidecar per run; got a second: ${a}`);
  }
  if (!o.sidecar) throw new Error("a sidecar path is required");
  if (o.only && o.only.length === 0) throw new Error("--only needs at least one mutant id");
  return o;
}

const isStr = (v) => typeof v === "string";

/** A repo-relative path that stays inside the repo, or null. */
function insideRepo(p) {
  if (!isStr(p) || p === "" || isAbsolute(p)) return null;
  const n = normalize(p);
  if (n === ".." || n.startsWith("../") || n === ".") return null;
  return n;
}

/**
 * The sidecar's mutants, checked. Every problem is collected and thrown at once, so a
 * sidecar is fixed in one pass rather than one error per run.
 */
export function validateSidecar(raw) {
  if (!Array.isArray(raw)) throw new Error("the sidecar must be a JSON array of mutants");
  const problems = [];
  const seen = new Set();
  const mutants = raw.map((m, i) => {
    const at = `mutant ${i}${m && isStr(m.id) ? ` (${m.id})` : ""}`;
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      problems.push(`${at}: not an object`);
      return null;
    }
    const known = new Set(["id", "edits", "test", "build", "syntax", "expect", "why"]);
    for (const k of Object.keys(m)) if (!known.has(k)) problems.push(`${at}: unknown key "${k}"`);
    if (!isStr(m.id) || !/^[\w.-]+$/.test(m.id))
      problems.push(`${at}: id must be a non-empty string of letters, digits, _ . -`);
    // Ids name report files, and a case-insensitive filesystem would merge "A" and "a".
    else if (seen.has(m.id.toLowerCase())) problems.push(`${at}: duplicate id`);
    else seen.add(m.id.toLowerCase());
    if (!Array.isArray(m.edits) || m.edits.length === 0)
      problems.push(`${at}: edits must be a non-empty array`);
    const edits = (Array.isArray(m.edits) ? m.edits : []).map((e, j) => {
      const eat = `${at} edit ${j}`;
      if (!e || typeof e !== "object") {
        problems.push(`${eat}: not an object`);
        return null;
      }
      const file = insideRepo(e.file);
      if (!file) problems.push(`${eat}: file must be a path relative to the repo root`);
      if (!isStr(e.find) || e.find === "") problems.push(`${eat}: find must be a non-empty string`);
      if (!isStr(e.replace)) problems.push(`${eat}: replace must be a string`);
      // A lone surrogate is written as U+FFFD, so the bytes could change less than the text.
      for (const k of ["find", "replace"])
        if (isStr(e[k]) && !e[k].isWellFormed())
          problems.push(`${eat}: ${k} is not well-formed Unicode`);
      if (isStr(e.find) && e.find === e.replace)
        problems.push(`${eat}: replace equals find, so it mutates nothing`);
      return { file, find: e.find, replace: e.replace };
    });
    const tests = isStr(m.test) ? [m.test] : Array.isArray(m.test) ? m.test : [];
    if (tests.length === 0 || !tests.every((t) => insideRepo(t)))
      problems.push(`${at}: test must be a test file path, or an array of them`);
    if (m.build !== undefined && typeof m.build !== "boolean")
      problems.push(`${at}: build must be true or false`);
    if (m.syntax !== undefined && typeof m.syntax !== "boolean")
      problems.push(`${at}: syntax must be true or false`);
    if (m.expect !== "red" && m.expect !== "survives")
      problems.push(`${at}: expect must be "red" or "survives"`);
    if (m.expect === "survives" && !(isStr(m.why) && m.why.trim()))
      problems.push(`${at}: expect "survives" needs a why`);
    if (m.why !== undefined && !isStr(m.why)) problems.push(`${at}: why must be a string`);
    return {
      id: m.id,
      edits,
      test: tests.map((t) => insideRepo(t) ?? t),
      build: m.build === true,
      syntax: m.syntax !== false,
      expect: m.expect,
      why: m.why,
    };
  });
  if (problems.length) throw new Error(`invalid sidecar:\n  ${problems.join("\n  ")}`);
  return mutants;
}

/**
 * At how many positions `find` occurs in `text`, overlaps included: "))" is ambiguous in
 * "f(g(h()))" even though it fits only once without overlapping.
 */
export function countMatches(text, find) {
  let n = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) n++;
  return n;
}

/**
 * The files' texts after the mutant's edits, applied in order, or a thrown error naming
 * every edit whose `find` does not match exactly once. Splices by index, never
 * `String.replace`, so a `$&` in a replacement stays literal.
 */
export function applyEdits(texts, mutant) {
  const out = new Map();
  const problems = [];
  mutant.edits.forEach((e, j) => {
    const cur = out.get(e.file) ?? texts.get(e.file);
    if (cur === undefined) {
      problems.push(`edit ${j}: ${e.file} is not readable`);
      return;
    }
    const n = countMatches(cur, e.find);
    if (n !== 1) {
      problems.push(`edit ${j}: find matches ${n} times in ${e.file}, not exactly once`);
      return;
    }
    const at = cur.indexOf(e.find);
    out.set(e.file, cur.slice(0, at) + e.replace + cur.slice(at + e.find.length));
  });
  if (problems.length) throw new Error(`mutant ${mutant.id}:\n  ${problems.join("\n  ")}`);
  return out;
}

/**
 * vitest 4.1's JSON reporter drops a timed-out case's "Test timed out" message and keeps
 * only the stack of the error it pre-made for it, which begins with this line (measured
 * on vitest 4.1.12, 2026-10-21; pinned by a test built from that output).
 */
export const TIMEOUT_MARK = "Error: STACK_TRACE_ERROR";

/**
 * What one vitest run says. Red only when a test case failed on an assertion or a throw.
 * Everything else is "stillborn", never a kill: a timeout (the run's or a case's), a file
 * that failed before its cases ran (a load error or a failing hook), a crash with no
 * report, or a run where no case passed or failed (all skipped). "survived" needs at least
 * one case that passed. A throw in beforeEach is vitest's own case failure, so it is red;
 * a throw in beforeAll or afterAll fails the file, not a case, so it is stillborn.
 */
export function classifyRun({ timedOut, report, code }) {
  if (timedOut) return { result: "stillborn", reason: "the run timed out" };
  if (!report || !Array.isArray(report.testResults))
    return { result: "stillborn", reason: `no vitest report (exit ${code})` };
  const n = { failed: 0, passed: 0, skipped: 0, timeouts: 0 };
  const fileErrors = [];
  const failedNames = [];
  for (const f of report.testResults) {
    const cases = Array.isArray(f.assertionResults) ? f.assertionResults : [];
    for (const c of cases) {
      if (c.status === "failed") {
        const msgs = Array.isArray(c.failureMessages) ? c.failureMessages : [];
        if (msgs.length && msgs.every((m) => isStr(m) && m.startsWith(TIMEOUT_MARK))) n.timeouts++;
        else {
          n.failed++;
          failedNames.push(isStr(c.fullName) ? c.fullName : String(c.title));
        }
      } else if (c.status === "passed") n.passed++;
      else n.skipped++;
    }
    if (f.status === "failed" && !cases.some((c) => c.status === "failed"))
      fileErrors.push(`${relativeName(f.name)}: ${firstLine(f.message) || "failed"}`);
  }
  const notes = [];
  if (n.timeouts) notes.push(`${n.timeouts} case(s) timed out`);
  if (fileErrors.length)
    notes.push(
      `file-level error (load error, or a beforeAll/afterAll hook): ${fileErrors.join("; ")}`,
    );
  if (n.failed > 0) {
    const shown = failedNames.slice(0, 3).map((t) => `"${t}"`);
    if (failedNames.length > 3) shown.push(`${failedNames.length - 3} more`);
    return { result: "red", ...n, reason: [`failed: ${shown.join(", ")}`, ...notes].join("; ") };
  }
  const reason = notes.join("; ");
  if (notes.length) return { result: "stillborn", ...n, reason };
  if (n.passed === 0)
    return { result: "stillborn", ...n, reason: `no case passed or failed (${n.skipped} skipped)` };
  if (code !== 0)
    return { result: "stillborn", ...n, reason: `exit ${code} with every case passing` };
  return { result: "survived", ...n, reason: "" };
}

function firstLine(m) {
  return isStr(m) ? m.split("\n")[0].slice(0, 200) : "";
}

/** The files a vitest report ran, relative to `root`. */
function ranFiles(report, root) {
  return report.testResults.map((f) => relativeName(f.name, root));
}

function relativeName(name, root) {
  if (!isStr(name)) return String(name);
  if (root && name.startsWith(root + "/")) return name.slice(root.length + 1);
  const i = name.lastIndexOf("/tests/");
  return i === -1 ? name : name.slice(i + 1);
}

/** Whether an outcome is what the sidecar said it would be. */
export function asExpected(expect, result) {
  return (expect === "red" && result === "red") || (expect === "survives" && result === "survived");
}

// ── processes ────────────────────────────────────────────────────────────────────────

/**
 * Spawns in its own process group, so a timeout or a signal can stop vitest's workers
 * with it. `active` holds the running children for the signal handler.
 */
export function makeRunner(active = new Set()) {
  const run = (cmd, args, { cwd, timeoutMs, env } = {}) =>
    new Promise((res) => {
      const child = spawn(cmd, args, {
        cwd,
        env: env ?? process.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      active.add(child);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              killGroup(child, "SIGKILL");
            }, timeoutMs);
      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      const done = (code, extra = "") => {
        if (timer) clearTimeout(timer);
        active.delete(child);
        res({ code, stdout, stderr: stderr + extra, timedOut });
      };
      child.on("error", (e) => done(127, e.message));
      child.on("close", (code) => done(code ?? 1));
    });
  run.active = active;
  return run;
}

function killGroup(child, sig) {
  try {
    process.kill(-child.pid, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  }
}

async function git(ctx, cwd, args) {
  const r = await ctx.run("git", args, { cwd, timeoutMs: 120_000 });
  if (r.code !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** `git status --porcelain` minus the node_modules link this script made itself. */
async function dirtyLines(ctx, cwd, ignore = []) {
  const out = await git(ctx, cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return out
    .split("\n")
    .filter(Boolean)
    .filter((l) => !ignore.includes(l));
}

// ── the run ──────────────────────────────────────────────────────────────────────────

export class Refusal extends Error {}

const SIGNAL_EXIT = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
const JS_FILE = /\.(mjs|cjs|js)$/;
const TS_FILE = /\.(ts|mts|cts|tsx)$/;

/**
 * A syntax error in `text`, or null. A test that spawns a mutated script sees its syntax
 * error as a failed case, so a mutant that does not parse is stillborn before any test
 * runs (a mutant can opt out with `syntax: false`, for a test that checks parsing). JS goes
 * through `node --check` as the module type its package.json gives it, JSON through
 * JSON.parse, and TS through the repo's own `typescript` (syntax only), when it resolves.
 * None of them catches a bad import in a spawned script, which still reads as a kill.
 */
export async function syntaxError({ file, text, root, run }) {
  if (file.endsWith(".json")) {
    try {
      JSON.parse(text);
      return null;
    } catch (e) {
      return e.message;
    }
  }
  if (JS_FILE.test(file)) {
    const ext = file.endsWith(".js") ? (jsIsModule(root, file) ? ".mjs" : ".cjs") : "";
    const dir = mkdtempSync(join(tmpdir(), "mutate-check-"));
    try {
      const tmp = join(dir, basename(file) + ext);
      writeFileSync(tmp, text);
      const c = await run(process.execPath, ["--check", tmp], { cwd: dir, timeoutMs: 60_000 });
      return c.code === 0
        ? null
        : firstLine(c.stderr.split("\n").find((l) => /Error/.test(l)) ?? "does not parse");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (TS_FILE.test(file)) {
    let ts;
    try {
      ts = createRequire(join(root, "package.json"))("typescript");
    } catch {
      return null;
    }
    const out = ts.transpileModule(text, { fileName: file, reportDiagnostics: true });
    const d = (out.diagnostics ?? [])[0];
    return d ? ts.flattenDiagnosticMessageText(d.messageText, " ") : null;
  }
  return null;
}

/** Whether node runs `file` (a .js) as an ES module: the nearest package.json's "type". */
function jsIsModule(root, file) {
  for (let d = dirname(join(root, file)); ; d = dirname(d)) {
    try {
      return JSON.parse(readFileSync(join(d, "package.json"), "utf-8")).type === "module";
    } catch {
      // no package.json here, or not readable: keep looking up
    }
    if (d === root || dirname(d) === d) return false;
  }
}

/**
 * Runs the sidecar's mutants. Returns the report; throws a Refusal (exit 2) for anything
 * found before the first mutant is applied, so a refused run has changed nothing. Any other
 * error carries the results so far as `error.report`.
 */
export async function mutate(o, deps = {}) {
  const run = deps.run ?? makeRunner();
  const ctx = { run, log: deps.log ?? ((s) => process.stderr.write(s + "\n")) };
  const proc = deps.process ?? process;
  const cwd = deps.cwd ?? process.cwd();

  // State the signal handler needs, set up before anything is created, so a signal at any
  // point removes exactly what this run made and nothing else.
  const st = { tmp: undefined, work: undefined, root: undefined, mode: "worktree" };
  const results = [];
  let rep;
  const applied = new Map(); // file -> original text, while a mutant is on disk
  let rebuildRootDist = false;
  let removeRootDist = false;
  let stopping = false;
  const restoreSync = () => {
    for (const [f, bytes] of applied) writeFileSync(join(st.work, f), bytes);
  };
  const cleanupSync = () => {
    for (const c of run.active ?? []) killGroup(c, "SIGKILL");
    if (st.work) restoreSync();
    if (st.mode === "worktree" && st.work && st.work !== st.root)
      // Twice --force: git locks a worktree while `worktree add` is still creating it.
      spawnSync("git", ["worktree", "remove", "--force", "--force", st.work], { cwd: st.root });
    if (st.mode === "in-place" && rebuildRootDist) {
      const b = spawnSync("pnpm", ["run", "build"], { cwd: st.root, stdio: "ignore" });
      if (b.status !== 0) ctx.log("mutate: WARNING: the rebuild of dist/ after the run failed");
    }
    if (st.mode === "in-place" && removeRootDist)
      rmSync(join(st.root, "dist"), { recursive: true, force: true });
    if (st.tmp) rmSync(st.tmp, { recursive: true, force: true });
  };
  const onSignal = (sig) => {
    if (stopping) {
      ctx.log(`mutate: ${sig} again; still restoring, please wait`);
      return;
    }
    stopping = true;
    cleanupSync();
    if (results.length && rep) {
      const partial = o.json
        ? JSON.stringify({ ...rep, stopped: sig }, null, 2) + "\n"
        : `${formatReport(rep)}\n(stopped by ${sig}; results so far)\n`;
      (deps.writeOut ?? ((t) => writeSync(1, t)))(partial);
    }
    ctx.log(`mutate: stopped by ${sig}; files restored`);
    proc.exit(SIGNAL_EXIT[sig]);
  };
  const handlers = Object.fromEntries(
    Object.keys(SIGNAL_EXIT).map((sig) => [sig, () => onSignal(sig)]),
  );
  for (const [sig, h] of Object.entries(handlers)) proc.on(sig, h);

  try {
    const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 60_000 });
    if (top.code !== 0) throw new Refusal(`${cwd} is not inside a git repository`);
    // vitest reports real paths, so every path compared with its report is real too.
    const root = realpathSync(top.stdout.trim());
    st.root = root;
    const sha = (await git(ctx, root, ["rev-parse", "HEAD"])).trim();

    const sidecarPath = resolve(cwd, o.sidecar);
    let raw;
    try {
      raw = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    } catch (e) {
      throw new Refusal(`cannot read ${o.sidecar}: ${e.message}`);
    }
    let mutants;
    try {
      mutants = validateSidecar(raw);
    } catch (e) {
      throw new Refusal(e.message);
    }
    if (o.only) {
      const missing = o.only.filter((id) => !mutants.some((m) => m.id === id));
      if (missing.length) throw new Refusal(`--only names no such mutant: ${missing.join(", ")}`);
      mutants = mutants.filter((m) => o.only.includes(m.id));
    }
    if (mutants.length === 0)
      throw new Refusal("the sidecar names no mutants, so nothing would run");

    const dirty = o.check ? [] : await dirtyLines(ctx, root);
    if (dirty.length)
      throw new Refusal(
        `the working tree is not clean; commit or stash first, so the run describes HEAD:\n  ${dirty.join("\n  ")}`,
      );

    // git status does not show a file marked skip-worktree or assume-unchanged, so a
    // "clean" tree could still differ from HEAD.
    const hidden = (await git(ctx, root, ["ls-files", "-v", "-z"]))
      .split("\0")
      .filter((l) => /^([a-z]|S) /.test(l))
      .map((l) => l.slice(2));
    if (hidden.length && !o.check)
      throw new Refusal(
        `git status cannot see local changes to files marked skip-worktree or assume-unchanged: ${hidden.slice(0, 5).join(", ")}${hidden.length > 5 ? ` and ${hidden.length - 5} more` : ""}`,
      );

    const files = [...new Set(mutants.flatMap((m) => m.edits.map((e) => e.file)))];
    const staged = (
      await git(ctx, root, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...files])
    )
      .split("\0")
      .filter(Boolean)
      .map((l) => ({ mode: l.split(" ")[0], file: l.split("\t")[1] }));
    const untracked = files.filter((f) => !staged.some((x) => x.file === f));
    if (untracked.length)
      throw new Refusal(`edits name files git does not track: ${untracked.join(", ")}`);
    const links = staged.filter((x) => x.mode === "120000").map((x) => x.file);
    if (links.length)
      throw new Refusal(`edits name symlinks, which would write through: ${links.join(", ")}`);
    const missingTests = [...new Set(mutants.flatMap((m) => m.test))].filter(
      (t) => !existsSync(join(root, t)) || !statSync(join(root, t)).isFile(),
    );
    if (missingTests.length) throw new Refusal(`no such test file: ${missingTests.join(", ")}`);
    if (!existsSync(join(root, "node_modules", ".bin", "vitest")))
      throw new Refusal("node_modules/.bin/vitest is missing: run pnpm install first");

    // Every find is checked before anything runs, against the bytes a checkout of HEAD
    // writes (`git cat-file --filters`): git's eol, ident and encoding attributes make those
    // differ from the blob, and a mutant built from the blob would rewrite every line ending,
    // not just its edit. --check reads the same bytes, so it agrees with the run. A run
    // refuses a file whose bytes on disk are not those, and a file that is not UTF-8, since
    // editing it as text would change bytes the mutant never named.
    const pristine = new Map();
    const problems = [];
    for (const f of files) {
      const show = spawnSync("git", ["cat-file", "--filters", `${sha}:${f}`], {
        cwd: root,
        maxBuffer: 1 << 30,
      });
      if (show.status !== 0) throw new Refusal(`cannot read ${f} at HEAD: ${show.stderr}`);
      const bytes = show.stdout;
      if (!o.check && !readFileSync(join(root, f)).equals(bytes))
        problems.push(`${f} on disk is not what a checkout of HEAD writes`);
      const text = bytes.toString("utf-8");
      if (!Buffer.from(text, "utf-8").equals(bytes)) problems.push(`${f} is not UTF-8 text`);
      pristine.set(f, text);
    }
    for (const m of mutants) {
      try {
        const out = applyEdits(pristine, m);
        if ([...out].every(([f, text]) => Buffer.from(text).equals(Buffer.from(pristine.get(f)))))
          problems.push(`mutant ${m.id}: its edits cancel out, leaving every file as it was`);
      } catch (e) {
        problems.push(e.message);
      }
    }
    if (problems.length) throw new Refusal(problems.join("\n"));
    // A file that already fails the syntax check at HEAD (a workflow body the tests wrap
    // in a function, say) cannot blame the mutant, so it is not checked.
    const checkable = new Set();
    for (const f of files)
      if (!(await syntaxError({ file: f, text: pristine.get(f), root, run }))) checkable.add(f);
    if (o.check) {
      // What the run would call stillborn before any test, said now.
      const unparsed = [];
      for (const m of mutants)
        if (m.syntax)
          for (const [f, text] of applyEdits(pristine, m))
            if (checkable.has(f)) {
              const err = await syntaxError({ file: f, text, root, run });
              if (err) unparsed.push(`${m.id}: ${f} (${err})`);
            }
      return {
        sha,
        mode: "check",
        command: "",
        sidecar: o.sidecar,
        planned: mutants.length,
        results,
        unparsed,
      };
    }

    st.tmp = realpathSync(mkdtempSync(join(deps.tmpdir ?? tmpdir(), "mutate-")));
    const outDir = join(st.tmp, "out");
    mkdirSync(join(outDir, "baseline"), { recursive: true });
    mkdirSync(join(outDir, "mutant"), { recursive: true });
    const ignore = [];
    if (o.inPlace) {
      st.mode = "in-place";
      st.work = root;
      // vitest's global setup in this repo rebuilds dist/ from whatever src/ holds, and
      // dist/ is ignored, so an in-place run rebuilds it from HEAD at the end, or removes
      // the dist/ it created.
      const hadDist = existsSync(join(root, "dist"));
      rebuildRootDist = hadDist && hasBuildScript(root);
      removeRootDist = !hadDist;
    } else {
      const wt = join(st.tmp, "wt");
      st.work = wt; // before the add, so a signal during it removes what it registered
      const r = await run("git", ["worktree", "add", "--detach", wt, sha], {
        cwd: root,
        timeoutMs: 120_000,
      });
      if (r.code !== 0)
        throw new Refusal(
          `git worktree add failed (${r.stderr.trim()}); rerun with --in-place to edit this checkout and restore it, knowing a SIGKILL mid-run would leave a mutant in it`,
        );
      const differs = files.filter(
        (f) => !readFileSync(join(wt, f)).equals(readFileSync(join(root, f))),
      );
      if (differs.length)
        throw new Refusal(
          `a fresh checkout of HEAD writes ${differs.join(", ")} differently from this one (eol or filter settings changed since it was checked out?)`,
        );
      if (existsSync(join(root, "pnpm-lock.yaml"))) {
        // pnpm refuses to run scripts (vitest's global setup runs `pnpm build`) over a
        // node_modules linked from elsewhere, so the worktree installs from the store.
        let ri = await run("pnpm", ["install", "--frozen-lockfile", "--offline"], {
          cwd: wt,
          timeoutMs: o.timeoutMs,
        });
        if (ri.code !== 0)
          ri = await run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
            cwd: wt,
            timeoutMs: o.timeoutMs,
          });
        if (ri.code !== 0) throw new Refusal(`pnpm install in the worktree failed:\n${tail(ri)}`);
      } else {
        symlinkSync(join(root, "node_modules"), join(wt, "node_modules"), "dir");
        ignore.push("?? node_modules");
      }
    }
    const work = st.work;

    const vitest = async (tests, outFile) => {
      const r = await run(
        join(work, "node_modules", ".bin", "vitest"),
        ["run", ...tests, "--reporter=json", `--outputFile=${outFile}`],
        { cwd: work, timeoutMs: o.timeoutMs },
      );
      let report;
      try {
        report = JSON.parse(readFileSync(outFile, "utf-8"));
      } catch {
        report = null;
      }
      return { ...classifyRun({ timedOut: r.timedOut, report, code: r.code }), run: r, report };
    };
    const build = () => run("pnpm", ["run", "build"], { cwd: work, timeoutMs: o.timeoutMs });
    const clean = async (after) => {
      const left = await dirtyLines(ctx, work, ignore);
      if (left.length)
        throw new Error(`the tree is not clean after ${after}:\n  ${left.join("\n  ")}`);
    };

    const outside = relative(root, sidecarPath).startsWith("..");
    const shown = outside ? sidecarPath : relative(root, sidecarPath);
    const command = [
      "node scripts/mutate.mjs",
      /\s/.test(shown) ? JSON.stringify(shown) : shown,
      ...(o.only ? ["--only", o.only.join(",")] : []),
      ...(o.inPlace ? ["--in-place"] : []),
      ...(o.timeoutMs !== DEFAULT_TIMEOUT_MS ? ["--timeout-ms", String(o.timeoutMs)] : []),
      ...(o.json ? ["--json"] : []),
    ].join(" ");
    rep = {
      sha,
      mode: st.mode,
      command,
      sidecar: shown,
      planned: mutants.length,
      results,
    };

    // Unmutated first, once for each distinct list of test files a mutant runs, since a
    // file can pass beside another and fail alone: a test that fails on HEAD would make
    // every mutant look red.
    if (mutants.some((m) => m.build)) {
      const b = await build();
      if (b.code !== 0) throw new Refusal(`the unmutated build failed:\n${tail(b)}`);
    }
    const sets = [...new Map(mutants.map((m) => [[...m.test].sort().join("\0"), m.test])).values()];
    for (const [n, tests] of sets.entries()) {
      const pre = await vitest(tests, join(outDir, "baseline", `${n}.json`));
      if (pre.result !== "survived")
        throw new Refusal(
          `the unmutated run of ${tests.join(" ")} did not pass (${pre.result}${pre.failed ? `, ${pre.failed} failed` : ""}${pre.reason ? `, ${pre.reason}` : ""}), so no mutant can be judged:\n${tail(pre.run)}`,
        );
      // Every named file must have run, or the table would list a test that never saw the
      // mutant. And vitest takes a path as a substring filter, ignoring case, so a named
      // file can pull in others, and a kill would be credited to a file the table does not
      // name.
      const ran = ranFiles(pre.report, work);
      const notRun = tests.filter((t) => !ran.includes(t));
      if (notRun.length)
        throw new Refusal(
          `vitest did not run ${notRun.join(", ")}: outside its include pattern, or missing from a checkout of HEAD`,
        );
      const extra = ran.filter((r) => !tests.includes(r));
      const known = [...new Set([...sets.flat(), ...ran])];
      const widened = tests.flatMap((t) => {
        const also = known.filter((x) => x !== t && x.toLowerCase().includes(t.toLowerCase()));
        return also.length ? [`${t} also matches ${also.join(", ")}`] : [];
      });
      if (widened.length || extra.length)
        throw new Refusal(
          `vitest takes a test path as a substring filter, ignoring case, and ${[...widened, ...(extra.length ? [`it also ran ${extra.join(", ")}`] : [])].join("; ")}: name paths no other file contains`,
        );
    }
    await clean("the unmutated run");

    for (const [i, m] of mutants.entries()) {
      const next = applyEdits(pristine, m);
      let outcome;
      try {
        for (const [f, text] of next) {
          applied.set(f, readFileSync(join(work, f)));
          writeFileSync(join(work, f), text);
        }
        const unparsed = [];
        for (const [f, text] of next)
          if (m.syntax && checkable.has(f)) {
            const err = await syntaxError({ file: f, text, root: work, run });
            if (err) unparsed.push(`${f} (${err})`);
          }
        if (unparsed.length)
          outcome = { result: "stillborn", reason: `does not parse: ${unparsed.join(", ")}` };
        else if (m.build) {
          const b = await build();
          outcome =
            b.code === 0
              ? await vitest(m.test, join(outDir, "mutant", `${m.id}.json`))
              : {
                  result: "stillborn",
                  reason: `build failed (exit ${b.code}): ${firstLine(
                    tail(b)
                      .split("\n")
                      .findLast((l) => /error/i.test(l)) ?? "",
                  )}`,
                };
        } else outcome = await vitest(m.test, join(outDir, "mutant", `${m.id}.json`));
        if (outcome.report) {
          const got = ranFiles(outcome.report, work);
          const other = got.filter((n) => !m.test.includes(n));
          const missing = m.test.filter((t) => !got.includes(t));
          if (other.length || missing.length)
            outcome = {
              result: "stillborn",
              reason: [
                other.length ? `vitest also ran ${other.join(", ")}` : "",
                missing.length ? `vitest did not run ${missing.join(", ")}` : "",
              ]
                .filter(Boolean)
                .join("; "),
            };
        }
      } finally {
        restoreSync();
      }
      for (const [f, bytes] of applied)
        if (!readFileSync(join(work, f)).equals(bytes))
          throw new Error(`${f} did not restore after ${m.id}`);
      applied.clear();
      results.push({
        id: m.id,
        expect: m.expect,
        result: outcome.result,
        failed: outcome.failed,
        passed: outcome.passed,
        skipped: outcome.skipped,
        timeouts: outcome.timeouts,
        reason: outcome.reason,
        test: m.test,
        build: m.build,
        why: m.why,
        ok: asExpected(m.expect, outcome.result),
      });
      ctx.log(`mutate: [${i + 1}/${mutants.length}] ${m.id}: ${outcome.result}`);
      // dist/ is ignored, so the restore leaves the mutant's build in it; the next
      // mutant must not run against that.
      if (m.build) {
        const b = await build();
        if (b.code !== 0) throw new Error(`the rebuild after ${m.id} failed:\n${tail(b)}`);
      }
      await clean(m.id);
    }
    if (rebuildRootDist) {
      const b = await build();
      if (b.code !== 0) throw new Error(`the rebuild of dist/ after the run failed:\n${tail(b)}`);
      rebuildRootDist = false;
    }
  } catch (e) {
    if (!(e instanceof Refusal) && rep) e.report = rep;
    throw e;
  } finally {
    stopping = true; // a signal now waits for the cleanup below rather than racing it
    cleanupSync();
    for (const [sig, h] of Object.entries(handlers)) proc.off(sig, h);
  }
  // A worktree run never writes to the checkout, which the user may edit meanwhile.
  const after = st.mode === "in-place" ? await dirtyLines(ctx, st.root) : [];
  if (after.length) {
    const e = new Error(`the tree is not clean after the run:\n  ${after.join("\n  ")}`);
    e.report = rep;
    throw e;
  }
  return rep;
}

function hasBuildScript(root) {
  try {
    return Boolean(JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).scripts?.build);
  } catch {
    return false;
  }
}

function tail(r) {
  return `${r.stdout}\n${r.stderr}`.trim().split("\n").slice(-30).join("\n");
}

/** Text safe inside a markdown table cell: a backslash first, so `\|` cannot unescape a pipe. */
export function cell(text) {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatReport(rep) {
  const c = (k) => rep.results.filter((r) => r.result === k).length;
  const unexpected = rep.results.filter((r) => !r.ok).length;
  const out = [
    `MUTATE_SUMMARY mutants=${rep.results.length} red=${c("red")} survived=${c("survived")} stillborn=${c("stillborn")} unexpected=${unexpected} sha=${rep.sha.slice(0, 12)} mode=${rep.mode}`,
    "",
    `At \`${rep.sha}\`, \`${rep.command}\`:`,
    "",
    "| Mutant | Expect | Result | Failed / ran | Test | Note |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rep.results) {
    const res = r.ok ? r.result : `**${r.result}** (unexpected)`;
    const counts =
      r.failed === undefined
        ? "–"
        : `${r.failed} / ${r.failed + r.passed + (r.timeouts ?? 0)}${r.timeouts ? ` (${r.timeouts} timed out)` : ""}${r.skipped ? ` (${r.skipped} skipped)` : ""}`;
    // An outcome that is not as expected shows why it happened first.
    const note = (r.ok ? [r.why, r.reason] : [r.reason, r.why]).filter(Boolean).join(" — ");
    out.push(
      `| ${r.id} | ${r.expect} | ${res} | ${counts} | ${r.test.map((t) => `\`${cell(t)}\``).join(", ")} | ${cell(note)} |`,
    );
  }
  return out.join("\n") + "\n";
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (process.argv.includes("--json"))
      process.stdout.write(JSON.stringify({ refused: e.message }, null, 2) + "\n");
    process.stderr.write(`mutate: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  let rep;
  try {
    rep = await mutate(o);
  } catch (e) {
    if (e instanceof Refusal) {
      if (o.json) process.stdout.write(JSON.stringify({ refused: e.message }, null, 2) + "\n");
      process.stderr.write(`mutate: refused: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    const r = e?.report;
    if (r?.results?.length) {
      const all = r.results.length === r.planned;
      if (o.json) process.stdout.write(JSON.stringify({ ...r, error: e.message }, null, 2) + "\n");
      else
        process.stdout.write(
          `${formatReport(r)}\n(${all ? "every mutant ran; the error came after" : "stopped early; results so far"})\n`,
        );
    }
    process.stderr.write(`mutate: error: ${e?.message ?? e}\n`);
    process.exitCode = 3;
    return;
  }
  if (o.check) {
    const ok = rep.unparsed.length === 0;
    if (o.json) process.stdout.write(JSON.stringify({ ok, ...rep }, null, 2) + "\n");
    else {
      process.stdout.write(
        `MUTATE_CHECK ${ok ? "ok" : "stillborn"} mutants=${rep.planned} sha=${rep.sha.slice(0, 12)}\n`,
      );
      for (const u of rep.unparsed) process.stdout.write(`  would not parse: ${u}\n`);
    }
    process.exitCode = ok ? 0 : 1;
    return;
  }
  process.stdout.write(o.json ? JSON.stringify(rep, null, 2) + "\n" : formatReport(rep));
  process.exitCode = rep.results.every((r) => r.ok) ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`mutate: ${e?.stack ?? e}\n`);
    process.exitCode = 3;
  });
}
