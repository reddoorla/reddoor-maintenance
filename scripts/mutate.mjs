#!/usr/bin/env node
// Runs a PR's named mutations from a sidecar file and prints the table its body pastes.
// P1-33 next-6 (#1596): every table before this was hand-built, and 9 harness failures in
// 13 days came from that (an applier that applied nothing, a sed that never matched,
// mutants left in a shared worktree). The rules below each answer one of those.
//
//   node scripts/mutate.mjs tests/<area>/<name>.mutations.json [--only id,id] [--in-place]
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
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { flagValue, isMain } from "./lib/cli.mjs";

const USAGE =
  "usage: node scripts/mutate.mjs <sidecar.json> [--only id,id] [--in-place] [--timeout-ms 600000] [--json]";

export const DEFAULT_TIMEOUT_MS = 600_000;

export function parseArgs(argv) {
  const o = {
    sidecar: undefined,
    only: undefined,
    inPlace: false,
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
    const known = new Set(["id", "edits", "test", "build", "expect", "why"]);
    for (const k of Object.keys(m)) if (!known.has(k)) problems.push(`${at}: unknown key "${k}"`);
    if (!isStr(m.id) || !/^[\w.-]+$/.test(m.id))
      problems.push(`${at}: id must be a non-empty string of letters, digits, _ . -`);
    else if (seen.has(m.id)) problems.push(`${at}: duplicate id`);
    else seen.add(m.id);
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
      if (isStr(e.find) && e.find === e.replace)
        problems.push(`${eat}: replace equals find, so it mutates nothing`);
      return { file, find: e.find, replace: e.replace };
    });
    const tests = isStr(m.test) ? [m.test] : Array.isArray(m.test) ? m.test : [];
    if (tests.length === 0 || !tests.every((t) => insideRepo(t)))
      problems.push(`${at}: test must be a test file path, or an array of them`);
    if (m.build !== undefined && typeof m.build !== "boolean")
      problems.push(`${at}: build must be true or false`);
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
      expect: m.expect,
      why: m.why,
    };
  });
  if (problems.length) throw new Error(`invalid sidecar:\n  ${problems.join("\n  ")}`);
  return mutants;
}

/** How many times `find` occurs in `text`, without overlaps. */
export function countMatches(text, find) {
  let n = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) n++;
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
 * What one vitest run says. Red only when a test case failed: a file that fails to load
 * (no cases, a message), a timeout, a crash with no report or a run with no cases at all
 * is "stillborn", never a kill.
 */
export function classifyRun({ timedOut, report, code }) {
  if (timedOut) return { result: "stillborn", reason: "timed out" };
  if (!report || !Array.isArray(report.testResults))
    return { result: "stillborn", reason: `no vitest report (exit ${code})` };
  let failed = 0;
  let total = 0;
  const loadFailures = [];
  for (const f of report.testResults) {
    const cases = Array.isArray(f.assertionResults) ? f.assertionResults : [];
    total += cases.length;
    failed += cases.filter((c) => c.status === "failed").length;
    if (f.status === "failed" && !cases.some((c) => c.status === "failed"))
      loadFailures.push(relativeName(f.name));
  }
  if (failed > 0)
    return {
      result: "red",
      failed,
      total,
      reason: loadFailures.length ? `also failed to load: ${loadFailures.join(", ")}` : "",
    };
  if (loadFailures.length)
    return {
      result: "stillborn",
      failed,
      total,
      reason: `failed to load: ${loadFailures.join(", ")}`,
    };
  if (total === 0) return { result: "stillborn", failed, total, reason: "no test cases ran" };
  if (code !== 0)
    return { result: "stillborn", failed, total, reason: `exit ${code} with every case passing` };
  return { result: "survived", failed, total, reason: "" };
}

function relativeName(name) {
  const i = isStr(name) ? name.lastIndexOf("/tests/") : -1;
  return i === -1 ? String(name) : name.slice(i + 1);
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

/**
 * Runs the sidecar's mutants. Returns the report; throws a Refusal (exit 2) for anything
 * found before the first mutant is applied, so a refused run has changed nothing.
 */
export async function mutate(o, deps = {}) {
  const run = deps.run ?? makeRunner();
  const ctx = { run, log: deps.log ?? ((s) => process.stderr.write(s + "\n")) };
  const proc = deps.process ?? process;
  const cwd = deps.cwd ?? process.cwd();
  const root = (await git(ctx, cwd, ["rev-parse", "--show-toplevel"])).trim();
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

  const dirty = await dirtyLines(ctx, root);
  if (dirty.length)
    throw new Refusal(
      `the working tree is not clean; commit or stash first, so the run describes HEAD:\n  ${dirty.join("\n  ")}`,
    );

  const files = [...new Set(mutants.flatMap((m) => m.edits.map((e) => e.file)))];
  const tracked = new Set(
    (await git(ctx, root, ["ls-files", "-z", "--", ...files])).split("\0").filter(Boolean),
  );
  const untracked = files.filter((f) => !tracked.has(f));
  if (untracked.length)
    throw new Refusal(`edits name files git does not track: ${untracked.join(", ")}`);
  const missingTests = [...new Set(mutants.flatMap((m) => m.test))].filter(
    (t) => !existsSync(join(root, t)),
  );
  if (missingTests.length) throw new Refusal(`no such test file: ${missingTests.join(", ")}`);
  const vitestBin = join(root, "node_modules", ".bin", "vitest");
  if (!existsSync(vitestBin))
    throw new Refusal(`${relative(cwd, vitestBin)} is missing: run pnpm install first`);

  // Every find is checked against HEAD before anything runs.
  const pristine = new Map(files.map((f) => [f, readFileSync(join(root, f), "utf-8")]));
  const problems = [];
  for (const m of mutants) {
    try {
      applyEdits(pristine, m);
    } catch (e) {
      problems.push(e.message);
    }
  }
  if (problems.length) throw new Refusal(problems.join("\n"));

  const tmp = mkdtempSync(join(deps.tmpdir ?? tmpdir(), "mutate-"));
  const outDir = join(tmp, "out");
  mkdirSync(outDir);
  let work = root;
  let mode = "in-place";
  const ignore = [];
  if (!o.inPlace) {
    const wt = join(tmp, "wt");
    const r = await run("git", ["worktree", "add", "--detach", wt, sha], {
      cwd: root,
      timeoutMs: 120_000,
    });
    if (r.code === 0) {
      work = wt;
      mode = "worktree";
    } else {
      ctx.log(
        `mutate: git worktree add failed, so the edits go in place and are restored: ${r.stderr.trim()}`,
      );
    }
  }

  // What to put back if the run is stopped: the original bytes of every file a mutant
  // has touched, written synchronously, so a signal mid-run leaves the tree as it was.
  const applied = new Map();
  const restoreSync = () => {
    for (const [f, text] of applied) writeFileSync(join(work, f), text);
  };
  let built = false;
  const cleanupSync = () => {
    for (const c of run.active ?? []) killGroup(c, "SIGKILL");
    restoreSync();
    if (mode === "worktree") {
      spawnSync("git", ["worktree", "remove", "--force", work], { cwd: root });
      spawnSync("git", ["worktree", "prune"], { cwd: root });
    } else if (built) {
      spawnSync("pnpm", ["run", "build"], { cwd: root, stdio: "ignore" });
    }
    rmSync(tmp, { recursive: true, force: true });
  };
  const onSignal = (sig) => {
    cleanupSync();
    ctx.log(`mutate: stopped by ${sig}; files restored`);
    proc.exit(sig === "SIGINT" ? 130 : 143);
  };
  const handlers = { SIGINT: () => onSignal("SIGINT"), SIGTERM: () => onSignal("SIGTERM") };
  for (const [s, h] of Object.entries(handlers)) proc.on(s, h);

  const vitest = async (tests, label) => {
    const outFile = join(outDir, `${label}.json`);
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
    return { ...classifyRun({ timedOut: r.timedOut, report, code: r.code }), run: r };
  };
  const build = async () => {
    built = true;
    return run("pnpm", ["run", "build"], { cwd: work, timeoutMs: o.timeoutMs });
  };

  const results = [];
  const command = ["node", "scripts/mutate.mjs", relative(root, sidecarPath) || o.sidecar]
    .concat(o.only ? ["--only", o.only.join(",")] : [])
    .concat(o.inPlace ? ["--in-place"] : [])
    .join(" ");
  try {
    // A pnpm repo installs into the worktree from the store: pnpm refuses to run scripts
    // (vitest's global setup runs `pnpm build`) over a node_modules linked from elsewhere.
    if (mode === "worktree" && existsSync(join(root, "pnpm-lock.yaml"))) {
      let r = await run("pnpm", ["install", "--frozen-lockfile", "--offline"], {
        cwd: work,
        timeoutMs: o.timeoutMs,
      });
      if (r.code !== 0)
        r = await run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
          cwd: work,
          timeoutMs: o.timeoutMs,
        });
      if (r.code !== 0) throw new Refusal(`pnpm install in the worktree failed:\n${tail(r)}`);
    } else if (mode === "worktree") {
      symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir");
      ignore.push("?? node_modules");
    }

    // Unmutated first: a test that fails on HEAD would make every mutant look red.
    const sets = new Map();
    for (const m of mutants) {
      const key = m.test.join(" ");
      const s = sets.get(key) ?? { tests: m.test, build: false };
      s.build ||= m.build;
      sets.set(key, s);
    }
    if ([...sets.values()].some((s) => s.build)) {
      const b = await build();
      if (b.code !== 0) throw new Refusal(`the unmutated build failed:\n${tail(b)}`);
    }
    let n = 0;
    for (const s of sets.values()) {
      const pre = await vitest(s.tests, `unmutated-${n++}`);
      if (pre.result !== "survived")
        throw new Refusal(
          `the unmutated run of ${s.tests.join(" ")} did not pass (${pre.result}${pre.failed ? `, ${pre.failed} failed` : ""}${pre.reason ? `, ${pre.reason}` : ""}), so no mutant can be judged:\n${tail(pre.run)}`,
        );
    }

    for (const m of mutants) {
      const current = new Map(files.map((f) => [f, readFileSync(join(work, f), "utf-8")]));
      const next = applyEdits(current, m);
      for (const [f, text] of next) {
        applied.set(f, current.get(f));
        writeFileSync(join(work, f), text);
      }
      let outcome;
      try {
        if (m.build) {
          const b = await build();
          outcome =
            b.code === 0
              ? await vitest(m.test, m.id)
              : { result: "stillborn", reason: `build failed (exit ${b.code})` };
        } else outcome = await vitest(m.test, m.id);
      } finally {
        restoreSync();
      }
      for (const [f, text] of applied)
        if (readFileSync(join(work, f), "utf-8") !== text)
          throw new Error(`${f} did not restore after ${m.id}`);
      applied.clear();
      // dist/ is ignored, so the restore leaves the mutant's build in it; the next
      // mutant must not run against that.
      if (m.build) {
        const b = await build();
        if (b.code !== 0) throw new Error(`the rebuild after ${m.id} failed:\n${tail(b)}`);
      }
      const left = await dirtyLines(ctx, work, ignore);
      if (left.length)
        throw new Error(`the tree is not clean after ${m.id}:\n  ${left.join("\n  ")}`);
      results.push({
        id: m.id,
        expect: m.expect,
        result: outcome.result,
        failed: outcome.failed,
        total: outcome.total,
        reason: outcome.reason,
        test: m.test,
        why: m.why,
        ok: asExpected(m.expect, outcome.result),
      });
    }
  } finally {
    for (const [s, h] of Object.entries(handlers)) proc.off(s, h);
    cleanupSync();
  }
  const after = await dirtyLines(ctx, root);
  if (after.length)
    throw new Error(`the tree is not clean after the run:\n  ${after.join("\n  ")}`);
  return { sha, mode, command, sidecar: relative(root, sidecarPath), results };
}

function tail(r) {
  return `${r.stdout}\n${r.stderr}`.trim().split("\n").slice(-30).join("\n");
}

export function formatReport(rep) {
  const c = (k) => rep.results.filter((r) => r.result === k).length;
  const unexpected = rep.results.filter((r) => !r.ok).length;
  const out = [
    `MUTATE_SUMMARY mutants=${rep.results.length} red=${c("red")} survived=${c("survived")} stillborn=${c("stillborn")} unexpected=${unexpected} sha=${rep.sha.slice(0, 12)} mode=${rep.mode}`,
    "",
    `At \`${rep.sha}\`, \`${rep.command}\`:`,
    "",
    "| Mutant | Expect | Result | Failed / cases | Test | Note |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rep.results) {
    const res = r.ok ? r.result : `**${r.result}** (unexpected)`;
    const counts = r.total === undefined ? "–" : `${r.failed} / ${r.total}`;
    const note = (r.expect === "survives" ? r.why : r.reason) ?? "";
    out.push(
      `| ${r.id} | ${r.expect} | ${res} | ${counts} | ${r.test.map((t) => `\`${t}\``).join(", ")} | ${note.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    );
  }
  return out.join("\n") + "\n";
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`mutate: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  let rep;
  try {
    rep = await mutate(o);
  } catch (e) {
    if (e instanceof Refusal) {
      process.stderr.write(`mutate: refused: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
  process.stdout.write(o.json ? JSON.stringify(rep, null, 2) + "\n" : formatReport(rep));
  process.exitCode = rep.results.every((r) => r.ok) ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`mutate: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
