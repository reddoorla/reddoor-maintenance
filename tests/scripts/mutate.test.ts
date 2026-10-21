import { describe, it, expect, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  syntaxError,
  parseArgs,
  validateSidecar,
  countMatches,
  applyEdits,
  classifyRun,
  asExpected,
  mutate,
  formatReport,
  makeRunner,
  Refusal,
  type Options,
} from "../../scripts/mutate.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/mutate.mjs", import.meta.url));
const TYPESCRIPT = realpathSync(
  fileURLToPath(new URL("../../node_modules/typescript", import.meta.url)),
);

const red = {
  id: "m1",
  edits: [{ file: "src/a.ts", find: "x", replace: "y" }],
  test: "tests/a.test.ts",
  expect: "red",
};

describe("parseArgs", () => {
  it("takes one sidecar and the flags", () => {
    expect(
      parseArgs(["t.mutations.json", "--only", "a, b", "--in-place", "--timeout-ms", "5"]),
    ).toEqual({
      sidecar: "t.mutations.json",
      only: ["a", "b"],
      inPlace: true,
      check: false,
      timeoutMs: 5,
      json: false,
    });
  });
  it("refuses no sidecar, two sidecars, an unknown flag and a bad timeout", () => {
    expect(() => parseArgs([])).toThrow(/sidecar path is required/);
    expect(() => parseArgs(["a.json", "b.json"])).toThrow(/second/);
    expect(() => parseArgs(["a.json", "--fast"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["a.json", "--timeout-ms", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["a.json", "--only"])).toThrow(/needs a value/);
    expect(() => parseArgs(["a.json", "--only", ","])).toThrow(/at least one mutant id/);
  });
});

describe("validateSidecar", () => {
  it("accepts a red mutant and a survivor with its why, normalising test to an array", () => {
    const ms = validateSidecar([
      red,
      { ...red, id: "m2", expect: "survives", why: "a second layer" },
    ]);
    expect(ms.map((m) => [m.id, m.test, m.build, m.expect])).toEqual([
      ["m1", ["tests/a.test.ts"], false, "red"],
      ["m2", ["tests/a.test.ts"], false, "survives"],
    ]);
  });
  it("refuses a survivor without a why", () => {
    expect(() => validateSidecar([{ ...red, expect: "survives" }])).toThrow(/needs a why/);
    expect(() => validateSidecar([{ ...red, expect: "survives", why: "  " }])).toThrow(
      /needs a why/,
    );
  });
  it("lists every problem at once", () => {
    let msg = "";
    try {
      validateSidecar([
        red,
        { ...red, expect: "dies" },
        { ...red, id: "m3", edits: [{ file: "../out.ts", find: "a", replace: "a" }] },
        { ...red, id: "m4", test: [], extra: 1 },
      ]);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/mutant 1 \(m1\): duplicate id/);
    expect(msg).toMatch(/mutant 1 \(m1\): expect must be/);
    expect(msg).toMatch(/m3\) edit 0: file must be a path relative/);
    expect(msg).toMatch(/m3\) edit 0: replace equals find/);
    expect(msg).toMatch(/m4\): unknown key "extra"/);
    expect(msg).toMatch(/m4\): test must be/);
  });
  it("refuses a sidecar that is not an array, and an empty edit list", () => {
    expect(() => validateSidecar({ mutants: [] })).toThrow(/JSON array/);
    expect(() => validateSidecar([{ ...red, edits: [] }])).toThrow(/non-empty array/);
    expect(() =>
      validateSidecar([{ ...red, edits: [{ file: "a", find: "", replace: "b" }] }]),
    ).toThrow(/find must be a non-empty/);
  });
});

describe("applyEdits", () => {
  const texts = new Map([["src/a.ts", "const a = 1;\nconst b = 1;\n"]]);
  it("applies an edit whose find matches once", () => {
    const out = applyEdits(texts, {
      id: "m",
      edits: [{ file: "src/a.ts", find: "a = 1", replace: "a = 2" }],
    });
    expect(out.get("src/a.ts")).toBe("const a = 2;\nconst b = 1;\n");
  });
  it("refuses a find that matches twice or never, naming both", () => {
    expect(() =>
      applyEdits(texts, {
        id: "m",
        edits: [
          { file: "src/a.ts", find: "= 1", replace: "= 2" },
          { file: "src/a.ts", find: "nowhere", replace: "x" },
        ],
      }),
    ).toThrow(/edit 0: find matches 2 times[\s\S]*edit 1: find matches 0 times/);
  });
  it("applies edits in order, each against the text the previous one left", () => {
    const out = applyEdits(texts, {
      id: "m",
      edits: [
        { file: "src/a.ts", find: "a = 1", replace: "a = 3" },
        { file: "src/a.ts", find: "a = 3", replace: "a = 4" },
      ],
    });
    expect(out.get("src/a.ts")).toBe("const a = 4;\nconst b = 1;\n");
  });
  it("keeps $& and $1 in a replacement literal", () => {
    const out = applyEdits(texts, {
      id: "m",
      edits: [{ file: "src/a.ts", find: "b = 1", replace: "b = '$&$1'" }],
    });
    expect(out.get("src/a.ts")).toContain("b = '$&$1'");
  });
  it("counts overlapping positions, so an overlapping find is ambiguous", () => {
    expect(countMatches("aaaa", "aa")).toBe(3);
    expect(countMatches("f(g(h()))", "))")).toBe(2);
    expect(countMatches("abc", "d")).toBe(0);
    expect(() =>
      applyEdits(new Map([["a", "f(g(h()))"]]), {
        id: "m",
        edits: [{ file: "a", find: "))", replace: ")" }],
      }),
    ).toThrow(/matches 2 times/);
  });
});

describe("classifyRun", () => {
  // Shapes copied from vitest 4.1.12's JSON reporter (2026-10-21), trimmed to the fields read.
  const file = (status: string, cases: object[], message = "", name = "/r/tests/a.test.ts") => ({
    name,
    status,
    message,
    assertionResults: cases,
  });
  const passed = { status: "passed", fullName: "p", failureMessages: [] };
  const failed = (fullName = "f") => ({
    status: "failed",
    fullName,
    failureMessages: ["AssertionError: expected 1 to be 2\n    at tests/a.test.ts:2:1"],
  });
  const timedOut = {
    status: "failed",
    fullName: "hangs",
    failureMessages: [
      "Error: STACK_TRACE_ERROR\n    at task (file:///r/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27)",
    ],
  };
  const skipped = { status: "skipped", fullName: "s", failureMessages: [] };
  const todo = { status: "todo", fullName: "t", failureMessages: [] };

  it("counts red only when a case failed, and names the failing cases", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", [failed("x y"), passed])] } }),
    ).toEqual({
      result: "red",
      failed: 1,
      passed: 1,
      skipped: 0,
      timeouts: 0,
      reason: 'failed: "x y"',
    });
  });
  it("names at most three failing cases", () => {
    const c = classifyRun({
      code: 1,
      report: { testResults: [file("failed", ["a", "b", "c", "d", "e"].map(failed))] },
    });
    expect(c.reason).toBe('failed: "a", "b", "c", 2 more');
  });
  it("calls a load failure stillborn, not a kill", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", [], "Cannot find module")] } }),
    ).toMatchObject({
      result: "stillborn",
      reason:
        "file-level error (load error, or a beforeAll/afterAll hook): tests/a.test.ts: Cannot find module",
    });
  });
  it("calls a failing beforeAll stillborn and gives its message", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", [skipped], "hook boom")] } }),
    ).toMatchObject({ result: "stillborn", reason: expect.stringMatching(/hook boom$/) });
  });
  it("calls a case that timed out stillborn, not red", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", [timedOut, passed])] } }),
    ).toMatchObject({ result: "stillborn", timeouts: 1, reason: "1 case(s) timed out" });
  });
  it("still counts a real failure red beside a timeout or a broken file, and says so", () => {
    const c = classifyRun({
      code: 1,
      report: {
        testResults: [
          file("failed", [failed(), timedOut]),
          file("failed", [], "boom", "/r/tests/b.test.ts"),
        ],
      },
    });
    expect(c.result).toBe("red");
    expect(c.reason).toBe(
      'failed: "f"; 1 case(s) timed out; file-level error (load error, or a beforeAll/afterAll hook): tests/b.test.ts: boom',
    );
  });
  it("calls a run where every case was skipped or todo stillborn, not survived", () => {
    expect(
      classifyRun({ code: 0, report: { testResults: [file("passed", [skipped, todo])] } }),
    ).toMatchObject({ result: "stillborn", reason: "no case passed or failed (2 skipped)" });
  });
  it("calls the run's own timeout, a missing report and no files stillborn", () => {
    expect(classifyRun({ code: 1, timedOut: true, report: null }).reason).toBe("the run timed out");
    expect(classifyRun({ code: 1, report: null }).reason).toMatch(/no vitest report/);
    expect(classifyRun({ code: 0, report: { testResults: [] } }).result).toBe("stillborn");
  });
  it("calls a non-zero exit with every case passing stillborn", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("passed", [passed])] } }).result,
    ).toBe("stillborn");
  });
  it("calls passing cases on a clean exit survived, counting skips beside them", () => {
    expect(
      classifyRun({ code: 0, report: { testResults: [file("passed", [passed, skipped])] } }),
    ).toMatchObject({ result: "survived", passed: 1, skipped: 1 });
  });
  it("matches expectations", () => {
    expect(asExpected("red", "red")).toBe(true);
    expect(asExpected("survives", "survived")).toBe(true);
    expect(asExpected("red", "stillborn")).toBe(false);
    expect(asExpected("survives", "stillborn")).toBe(false);
  });
});

// ── against a real git repo, with a fake vitest whose verdict is src/value.txt ──────────

const FAKE_VITEST = `
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const files = args.filter((a) => a !== "run" && !a.startsWith("--"))
  .filter((a) => a !== process.env.MUTATE_FAKE_SKIP);
// Like vitest's substring filter pulling in a second file.
if (process.env.MUTATE_FAKE_ALSO) files.push(process.env.MUTATE_FAKE_ALSO);
// Like the repo's vitest global setup, which rebuilds dist/ from whatever src/ holds.
if (process.env.MUTATE_FAKE_COPY) {
  mkdirSync("dist", { recursive: true });
  copyFileSync("src/value.txt", "dist/value.txt");
}
const from = process.env.MUTATE_FAKE_READ || "src/value.txt";
let value = existsSync(from) ? readFileSync(from, "utf-8").trim() : "missing";
// A test that checks src/crlf.txt keeps its CRLF line endings.
if (process.env.MUTATE_FAKE_CRLF && !readFileSync("src/crlf.txt", "utf-8").includes("\\r\\n")) value = "fail";
// tests/b.test.ts passes only when tests/a.test.ts runs beside it (shared state).
if (process.env.MUTATE_FAKE_PAIR && files.includes("tests/b.test.ts") && !files.includes("tests/a.test.ts")) value = "fail";
const link = lstatSync("node_modules").isSymbolicLink() ? "link" : "dir";
if (process.env.MUTATE_FAKE_LOG) appendFileSync(process.env.MUTATE_FAKE_LOG, process.cwd() + " " + value + " " + link + "\\n");
const kase = (status) => ({ status, fullName: "case " + status, failureMessages: status === "failed" ? ["AssertionError: no"] : [] });
const report = (cases, message = "") => ({
  testResults: files.map((f) => ({ name: process.cwd() + "/" + f, status: cases.includes("failed") || message ? "failed" : "passed", message, assertionResults: cases.map(kase) })),
});
if (value === "hang") {
  writeFileSync(process.env.MUTATE_FAKE_MARKER, String(process.pid));
  setInterval(() => {}, 1000);
} else if (value === "fail") {
  writeFileSync(out, JSON.stringify(report(["failed", "passed"]))); process.exit(1);
} else if (value === "load") {
  writeFileSync(out, JSON.stringify(report([], "Cannot find module"))); process.exit(1);
} else if (value === "nojson") {
  process.exit(1);
} else if (value === "skipped") {
  writeFileSync(out, JSON.stringify(report(["skipped", "todo"])));
} else if (value === "litter") {
  writeFileSync("tests/__litter.txt", "x");
  writeFileSync(out, JSON.stringify(report(["passed"])));
} else if (value === "pass" || value === "survive") {
  writeFileSync(out, JSON.stringify(report(["passed", "passed"])));
} else {
  writeFileSync(out, JSON.stringify(report(["failed"]))); process.exit(1);
}
`;

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function sh(cwd: string, cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/**
 * A committed repo with src/value.txt = `value`, a test file, a script, a symlink and the
 * fake vitest. With `pnpm`, the fake is a `file:` dependency installed by pnpm, with a
 * committed lockfile, so the script takes its pnpm-install path.
 */
function fixture(value = "pass", { pnpm = false } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutate-fixture-")));
  temps.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src", "value.txt"), `${value}\n`);
  writeFileSync(join(dir, "src", "cli.mjs"), "console.log(1 + 1);\n");
  // A workflow-style body the tests would wrap in a function: node --check rejects it at HEAD.
  writeFileSync(join(dir, "src", "body.js"), "const n = 1;\nreturn n * 2;\n");
  writeFileSync(join(dir, "src", "typed.ts"), "const x: number = 5;\nexport { x };\n");
  writeFileSync(join(dir, "src", "data.json"), '{ "a": 1 }\n');
  writeFileSync(join(dir, "src", "latin1.txt"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  symlinkSync("value.txt", join(dir, "src", "link.txt"));
  writeFileSync(join(dir, "tests", "a.test.ts"), "// read by the fake vitest only\n");
  writeFileSync(join(dir, "tests", "b.test.ts"), "// read by the fake vitest only\n");
  mkdirSync(join(dir, "spec"));
  writeFileSync(join(dir, "spec", "a.test.ts"), "// read by the fake vitest only\n");
  mkdirSync(join(dir, "other", "tests"), { recursive: true });
  writeFileSync(join(dir, "other", "tests", "a.test.ts"), "// read by the fake vitest only\n");
  // A SvelteKit-style bracket path, beside a symlink its glob reading would match.
  mkdirSync(join(dir, "src", "[slug]"));
  writeFileSync(join(dir, "src", "[slug]", "a.txt"), "x\n");
  mkdirSync(join(dir, "src", "s"));
  symlinkSync("../value.txt", join(dir, "src", "s", "a.txt"));
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n");
  const build =
    "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').copyFileSync('src/value.txt','dist/value.txt')\"";
  const pkg: Record<string, unknown> = { name: "fixture", private: true, scripts: { build } };
  if (pnpm) {
    mkdirSync(join(dir, "fake"));
    writeFileSync(
      join(dir, "fake", "package.json"),
      JSON.stringify({ name: "fake-vitest", version: "1.0.0", bin: { vitest: "index.mjs" } }),
    );
    writeFileSync(join(dir, "fake", "index.mjs"), `#!/usr/bin/env node\n${FAKE_VITEST}`);
    pkg.devDependencies = { "fake-vitest": "file:./fake" };
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    sh(dir, "pnpm", ["install", "--offline"]);
  } else {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "fake-vitest.mjs"), FAKE_VITEST);
    const bin = join(dir, "node_modules", ".bin", "vitest");
    writeFileSync(bin, `#!/bin/sh\nexec node "$(dirname "$0")/../fake-vitest.mjs" "$@"\n`);
    chmodSync(bin, 0o755);
    symlinkSync(TYPESCRIPT, join(dir, "node_modules", "typescript"));
  }
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  sh(dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  sh(dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  const side = mkdtempSync(join(tmpdir(), "mutate-side-"));
  temps.push(side);
  return { dir, side, log: join(side, "log"), marker: join(side, "marker") };
}

function sidecar(side: string, mutants: unknown[]) {
  const p = join(side, "x.mutations.json");
  writeFileSync(p, JSON.stringify(mutants));
  return p;
}

const toValue = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  id,
  edits: [{ file: "src/value.txt", find: "pass", replace: value }],
  test: "tests/a.test.ts",
  expect: "red",
  ...extra,
});

const opts = (sidecarPath: string, extra: Partial<Options> = {}): Options => ({
  sidecar: sidecarPath,
  only: undefined,
  inPlace: false,
  check: false,
  timeoutMs: 60_000,
  json: false,
  ...extra,
});

function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const status = (dir: string) => sh(dir, "git", ["status", "--porcelain", "--untracked-files=all"]);
const worktrees = (dir: string) => sh(dir, "git", ["worktree", "list"]).trim().split("\n").length;
const quiet = { log: () => {} };

const logLines = (log: string) => readFileSync(log, "utf-8").trim().split("\n");

describe("mutate, against a real repo", () => {
  it("runs the unmutated test first, then each mutant in a throwaway worktree, and leaves nothing behind", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("kill", "fail", { why: "the value is checked" }),
      toValue("keep", "survive", { expect: "survives", why: "a second layer" }),
    ]);
    const tmp = mkdtempSync(join(tmpdir(), "mutate-tmp-"));
    temps.push(tmp);
    const rep = await withEnv({ MUTATE_FAKE_LOG: f.log }, () =>
      mutate(opts(p), { cwd: f.dir, tmpdir: tmp, ...quiet }),
    );
    expect(rep.mode).toBe("worktree");
    expect(rep.results.map((r) => [r.id, r.result, r.ok])).toEqual([
      ["kill", "red", true],
      ["keep", "survived", true],
    ]);
    const runs = logLines(f.log);
    expect(runs.map((l) => l.split(" ")[1])).toEqual(["pass", "fail", "survive"]);
    expect(runs.every((l) => !l.startsWith(f.dir + " "))).toBe(true);
    expect(status(f.dir)).toBe("");
    expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
    expect(worktrees(f.dir)).toBe(1);
    expect(readdirSync(tmp)).toEqual([]);
    expect(rep.sha).toBe(sh(f.dir, "git", ["rev-parse", "HEAD"]).trim());
    expect(rep.command).toBe(`node scripts/mutate.mjs ${p} --timeout-ms 60000`);
    const table = formatReport(rep);
    expect(table).toMatch(/^MUTATE_SUMMARY mutants=2 red=1 survived=1 stillborn=0 unexpected=0 /);
    expect(table).toContain(`At \`${rep.sha}\``);
    expect(table).toContain(
      '| kill | red | red | 1 / 2 | `tests/a.test.ts` | the value is checked — failed: "case failed" |',
    );
    expect(table).toContain(
      "| keep | survives | survived | 0 / 2 | `tests/a.test.ts` | a second layer |",
    );
  });

  it("installs a pnpm repo's dependencies into the worktree instead of linking them", async () => {
    const f = fixture("pass", { pnpm: true });
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    const rep = await withEnv({ MUTATE_FAKE_LOG: f.log }, () =>
      mutate(opts(p), { cwd: f.dir, ...quiet }),
    );
    expect(rep.results[0]?.result).toBe("red");
    expect(logLines(f.log).map((l) => l.split(" ").slice(1).join(" "))).toEqual([
      "pass dir",
      "fail dir",
    ]);
    expect(status(f.dir)).toBe("");
    expect(worktrees(f.dir)).toBe(1);
  });

  it("refuses a dirty tree before running anything, untracked files included", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    writeFileSync(join(f.dir, "stray.txt"), "x");
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /not clean[\s\S]*stray\.txt/,
      );
    });
    expect(existsSync(f.log)).toBe(false);
  });

  it("aborts when the unmutated test fails, and applies no mutant", async () => {
    const f = fixture("broken");
    const p = sidecar(f.side, [
      {
        ...toValue("kill", "fail"),
        edits: [{ file: "src/value.txt", find: "broken", replace: "fail" }],
      },
    ]);
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      const err = await mutate(opts(p), { cwd: f.dir, ...quiet }).catch((e) => e);
      expect(err).toBeInstanceOf(Refusal);
      expect(err.message).toMatch(
        /unmutated run of tests\/a\.test\.ts did not pass \(red, 1 failed/,
      );
    });
    expect(logLines(f.log)).toHaveLength(1);
    expect(worktrees(f.dir)).toBe(1);
  });

  it("aborts when the unmutated test runs no case at all", async () => {
    const f = fixture("skipped");
    const p = sidecar(f.side, [
      {
        ...toValue("m", "fail"),
        edits: [{ file: "src/value.txt", find: "skipped", replace: "x" }],
      },
    ]);
    await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /did not pass \(stillborn, no case passed or failed \(2 skipped\)\)/,
    );
  });

  it("refuses a find that matches twice before running anything", async () => {
    const f = fixture("pass pass");
    const p = sidecar(f.side, [toValue("twice", "fail")]);
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /find matches 2 times/,
      );
    });
    expect(existsSync(f.log)).toBe(false);
  });

  it("refuses an untracked file, a symlink, and a directory outside git", async () => {
    const f = fixture();
    const edit = (file: string) =>
      sidecar(f.side, [{ ...toValue("m", "fail"), edits: [{ file, find: "pass", replace: "x" }] }]);
    await expect(mutate(opts(edit("src/none.txt")), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /does not track: src\/none\.txt/,
    );
    await expect(mutate(opts(edit("src/link.txt")), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /symlinks, which would write through: src\/link\.txt/,
    );
    const bare = mkdtempSync(join(tmpdir(), "mutate-bare-"));
    temps.push(bare);
    await expect(
      mutate(opts(edit("src/value.txt")), { cwd: bare, ...quiet }),
    ).rejects.toBeInstanceOf(Refusal);
  });

  it("calls a mutated script that does not parse stillborn, without running the test", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      {
        id: "syntax",
        edits: [{ file: "src/cli.mjs", find: "1 + 1);", replace: "1 + 1;" }],
        test: "tests/a.test.ts",
        expect: "red",
      },
    ]);
    const rep = await withEnv({ MUTATE_FAKE_LOG: f.log }, () =>
      mutate(opts(p), { cwd: f.dir, ...quiet }),
    );
    expect(rep.results[0]).toMatchObject({
      result: "stillborn",
      reason: expect.stringMatching(/^does not parse: src\/cli\.mjs \(SyntaxError/),
      ok: false,
    });
    expect(logLines(f.log)).toHaveLength(1);
  });

  it("reports a load failure, a crash with no report and an unexpected survivor as not ok", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("load", "load"),
      toValue("crash", "nojson"),
      toValue("lives", "survive"),
      toValue("why-hidden", "load", { expect: "survives", why: "WHY TEXT" }),
    ]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results.map((r) => [r.id, r.result, r.ok])).toEqual([
      ["load", "stillborn", false],
      ["crash", "stillborn", false],
      ["lives", "survived", false],
      ["why-hidden", "stillborn", false],
    ]);
    const table = formatReport(rep);
    expect(table).toContain("| lives | red | **survived** (unexpected) |");
    expect(table).toMatch(
      /\| why-hidden \| survives \| \*\*stillborn\*\* \(unexpected\) \| 0 \/ 0 \| `tests\/a\.test\.ts` \| file-level error[^|]*Cannot find module — WHY TEXT \|/,
    );
    expect(status(f.dir)).toBe("");
  });

  it("refuses when git worktree add fails, rather than editing the checkout", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    const real = makeRunner();
    const run = Object.assign(
      (cmd: string, args: string[], o?: Parameters<typeof real>[2]) =>
        cmd === "git" && args[0] === "worktree" && args[1] === "add"
          ? Promise.resolve({ code: 128, stdout: "", stderr: "fatal: no", timedOut: false })
          : real(cmd, args, o),
      { active: real.active },
    );
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, run, ...quiet })).rejects.toThrow(
        /worktree add failed \(fatal: no\); rerun with --in-place/,
      );
    });
    expect(existsSync(f.log)).toBe(false);
    expect(status(f.dir)).toBe("");
  });

  it("restores the file in place with --in-place, and rebuilds the dist/ the tests rebuilt", async () => {
    const f = fixture();
    sh(f.dir, "pnpm", ["run", "build"]);
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    await withEnv({ MUTATE_FAKE_LOG: f.log, MUTATE_FAKE_COPY: "1" }, async () => {
      const rep = await mutate(opts(p, { inPlace: true }), { cwd: f.dir, ...quiet });
      expect(rep.mode).toBe("in-place");
      expect(rep.results[0]?.result).toBe("red");
    });
    expect(logLines(f.log)).toEqual([`${f.dir} pass dir`, `${f.dir} fail dir`]);
    expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
    expect(readFileSync(join(f.dir, "dist", "value.txt"), "utf-8")).toBe("pass\n");
    expect(status(f.dir)).toBe("");
  });

  it("rebuilds before the test when the mutant says build, and after it", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("built", "fail", { build: true }),
      toValue("stale", "fail", { expect: "survives", why: "dist is not rebuilt" }),
    ]);
    const rep = await withEnv({ MUTATE_FAKE_READ: "dist/value.txt" }, () =>
      mutate(opts(p, { only: ["built"] }), { cwd: f.dir, ...quiet }),
    );
    expect(rep.results.map((r) => [r.id, r.result])).toEqual([["built", "red"]]);
    // "stale" does not build, so it reads dist; it survives only if dist was rebuilt
    // unmutated after "built", rather than still holding "built"'s output.
    const rep2 = await withEnv({ MUTATE_FAKE_READ: "dist/value.txt" }, () =>
      mutate(opts(p), { cwd: f.dir, ...quiet }),
    );
    expect(rep2.results.map((r) => [r.id, r.result])).toEqual([
      ["built", "red"],
      ["stale", "survived"],
    ]);
  });

  it("prints the results so far and exits 3 when a mutant leaves a file behind", () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("first", "fail"),
      toValue("messy", "litter"),
      toValue("third", "fail"),
    ]);
    const r = spawnSync(process.execPath, [SCRIPT, p], { cwd: f.dir, encoding: "utf-8" });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("| first | red | red |");
    expect(r.stdout).toContain("(stopped early; results so far)");
    expect(r.stdout).not.toContain("| third |");
    expect(r.stderr).toMatch(
      /error: the tree is not clean after messy:\s+\?\? tests\/__litter\.txt/,
    );
    expect(status(f.dir)).toBe("");
    expect(worktrees(f.dir)).toBe(1);
  });

  it("refuses a sidecar that runs no mutant", async () => {
    const f = fixture();
    await expect(mutate(opts(sidecar(f.side, [])), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /names no mutants/,
    );
  });

  it("refuses a test path that is a directory, or a filter that ran another file", async () => {
    const f = fixture();
    const dirTest = sidecar(f.side, [toValue("m", "fail", { test: "tests" })]);
    await expect(mutate(opts(dirTest), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /no such test file: tests$/,
    );
    const p = sidecar(f.side, [toValue("m", "fail")]);
    await withEnv({ MUTATE_FAKE_ALSO: "sub/tests/a.test.ts", MUTATE_FAKE_LOG: f.log }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /substring filter, ignoring case, and tests\/a\.test\.ts also matches sub\/tests\/a\.test\.ts/,
      );
    });
    expect(logLines(f.log)).toHaveLength(1);
  });

  it("refuses a file that is not UTF-8, which it could not restore byte for byte", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      { ...toValue("m", "fail"), edits: [{ file: "src/latin1.txt", find: "caf", replace: "cof" }] },
    ]);
    await expect(mutate(opts(p, { inPlace: true }), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /src\/latin1\.txt is not UTF-8 text/,
    );
    expect(status(f.dir)).toBe("");
  });

  it("checks TS and JSON syntax, and does not blame a mutant for a file broken at HEAD", async () => {
    const f = fixture();
    const edit = (id: string, file: string, find: string, replace: string, more = {}) => ({
      id,
      edits: [{ file, find, replace }],
      test: "tests/a.test.ts",
      expect: "red",
      ...more,
    });
    const p = sidecar(f.side, [
      edit("ts", "src/typed.ts", "= 5;", "= ;"),
      edit("json", "src/data.json", '"a": 1', '"a": '),
      edit("body", "src/body.js", "n * 2", "n * 3", {
        expect: "survives",
        why: "nothing reads it",
      }),
    ]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results.map((r) => [r.id, r.result])).toEqual([
      ["ts", "stillborn"],
      ["json", "stillborn"],
      ["body", "survived"],
    ]);
    expect(rep.results[0]?.reason).toMatch(/^does not parse: src\/typed\.ts \(Expression expected/);
    expect(rep.results[1]?.reason).toMatch(/^does not parse: src\/data\.json \(/);
  });

  it("validates without running anything under --check", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      const rep = await mutate(opts(p, { check: true }), { cwd: f.dir, ...quiet });
      expect(rep).toMatchObject({ mode: "check", planned: 1, results: [] });
    });
    expect(existsSync(f.log)).toBe(false);
    const r = spawnSync(process.execPath, [SCRIPT, p, "--check"], {
      cwd: f.dir,
      encoding: "utf-8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^MUTATE_CHECK ok mutants=1 sha=/);
  });

  it("does not fail a worktree run because the checkout was edited meanwhile", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    const real = makeRunner();
    const run = Object.assign(
      (cmd: string, args: string[], o?: Parameters<typeof real>[2]) => {
        if (cmd.endsWith("vitest")) writeFileSync(join(f.dir, "src", "value.txt"), "edited\n");
        return real(cmd, args, o);
      },
      { active: real.active },
    );
    const rep = await mutate(opts(p), { cwd: f.dir, run, ...quiet });
    expect(rep.results[0]?.result).toBe("red");
  });

  it("prints JSON, not the table, when a --json run stops on an error", () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("first", "fail"), toValue("messy", "litter")]);
    const r = spawnSync(process.execPath, [SCRIPT, p, "--json"], { cwd: f.dir, encoding: "utf-8" });
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout);
    expect(out.results.map((x: { id: string }) => x.id)).toEqual(["first", "messy"]);
    expect(out.error).toMatch(/not clean after messy/);
  });

  it("prints the results so far when stopped by a signal", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("first", "fail"), toValue("hang", "hang")]);
    const child = spawn(process.execPath, [SCRIPT, p], {
      cwd: f.dir,
      env: { ...process.env, MUTATE_FAKE_MARKER: f.marker },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 30_000;
    while (!existsSync(f.marker) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    child.kill("SIGINT");
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code, stderr).toBe(130);
    expect(stdout).toContain("| first | red | red |");
    expect(stdout).toContain("(stopped by SIGINT; results so far)");
    expect(stderr).toContain("mutate: [1/2] first: red");
  });

  it("refuses a named test file that vitest does not run", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("m", "fail", { test: ["tests/a.test.ts", "tests/b.test.ts"] }),
    ]);
    await withEnv({ MUTATE_FAKE_SKIP: "tests/b.test.ts" }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /vitest did not run tests\/b\.test\.ts/,
      );
    });
  });

  it("refuses two mutants whose test paths overlap as filters", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("a", "fail"),
      toValue("b", "fail", { test: "other/tests/a.test.ts" }),
    ]);
    await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /tests\/a\.test\.ts also matches other\/tests\/a\.test\.ts/,
    );
  });

  it("matches vitest's real paths when the temp dir is reached through a symlink", async () => {
    const f = fixture();
    const real = mkdtempSync(join(tmpdir(), "mutate-real-"));
    temps.push(real);
    const link = join(f.side, "tmp-link");
    symlinkSync(real, link);
    const p = sidecar(f.side, [toValue("kill", "fail", { test: "spec/a.test.ts" })]);
    const rep = await mutate(opts(p), { cwd: f.dir, tmpdir: link, ...quiet });
    expect(rep.results[0]?.result).toBe("red");
  });

  it("refuses files git status cannot see, marked skip-worktree", async () => {
    const f = fixture();
    sh(f.dir, "git", ["update-index", "--skip-worktree", "src/cli.mjs"]);
    writeFileSync(join(f.dir, "src", "cli.mjs"), "console.log(2);\n");
    expect(status(f.dir)).toBe("");
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /skip-worktree or assume-unchanged: src\/cli\.mjs/,
    );
  });

  it("reads each file at HEAD, and takes bracket paths literally", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      {
        id: "bracket",
        edits: [{ file: "src/[slug]/a.txt", find: "x", replace: "y" }],
        test: "tests/a.test.ts",
        expect: "survives",
        why: "nothing reads it",
      },
    ]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results[0]?.result).toBe("survived");
  });

  it("removes a dist/ an in-place run created", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    await withEnv({ MUTATE_FAKE_COPY: "1" }, () =>
      mutate(opts(p, { inPlace: true }), { cwd: f.dir, ...quiet }),
    );
    expect(existsSync(join(f.dir, "dist"))).toBe(false);
  });

  it("lets a mutant opt out of the syntax check", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      {
        id: "unchecked",
        edits: [{ file: "src/cli.mjs", find: "1 + 1);", replace: "1 + 1;" }],
        test: "tests/a.test.ts",
        syntax: false,
        expect: "survives",
        why: "nothing runs cli.mjs",
      },
    ]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results[0]?.result).toBe("survived");
  });

  it("--check accepts a dirty tree, flags a mutant that will not parse, and speaks JSON", () => {
    const f = fixture();
    writeFileSync(join(f.dir, "tests", "draft.mutations.json"), "[]");
    const p = sidecar(f.side, [
      toValue("kill", "fail"),
      {
        id: "syntax",
        edits: [{ file: "src/cli.mjs", find: "1 + 1);", replace: "1 + 1;" }],
        test: "tests/a.test.ts",
        expect: "red",
      },
    ]);
    const r = spawnSync(process.execPath, [SCRIPT, p, "--check"], {
      cwd: f.dir,
      encoding: "utf-8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^MUTATE_CHECK stillborn mutants=2 /);
    expect(r.stdout).toContain("would not parse: syntax: src/cli.mjs (SyntaxError");
    const j = spawnSync(process.execPath, [SCRIPT, p, "--check", "--json"], {
      cwd: f.dir,
      encoding: "utf-8",
    });
    expect(JSON.parse(j.stdout)).toMatchObject({ ok: false, planned: 2, mode: "check" });
  });

  it("runs the unmutated baseline for each test list, catching a test that only passes beside another", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("both", "fail", { test: ["tests/a.test.ts", "tests/b.test.ts"] }),
      toValue("alone", "fail", { test: "tests/b.test.ts" }),
    ]);
    await withEnv({ MUTATE_FAKE_PAIR: "1" }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /the unmutated run of tests\/b\.test\.ts did not pass/,
      );
    });
  });

  it("refuses a test path vitest would widen to a file differing only in case", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("m", "fail")]);
    await withEnv({ MUTATE_FAKE_ALSO: "tests/A.test.ts" }, async () => {
      await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
        /tests\/a\.test\.ts also matches tests\/A\.test\.ts/,
      );
    });
  });

  it("mutates the bytes a checkout holds, so CRLF line endings stay CRLF", async () => {
    const f = fixture();
    writeFileSync(join(f.dir, ".gitattributes"), "src/crlf.txt text eol=crlf\n");
    writeFileSync(join(f.dir, "src", "crlf.txt"), "a = 1\nb = 2\n");
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "crlf"]);
    rmSync(join(f.dir, "src", "crlf.txt"));
    sh(f.dir, "git", ["checkout", "--", "src/crlf.txt"]);
    expect(readFileSync(join(f.dir, "src", "crlf.txt"), "utf-8")).toBe("a = 1\r\nb = 2\r\n");
    const p = sidecar(f.side, [
      {
        id: "b",
        edits: [{ file: "src/crlf.txt", find: "b = 2", replace: "b = 3" }],
        test: "tests/a.test.ts",
        expect: "survives",
        why: "nothing reads b",
      },
    ]);
    // --check reads the bytes the run reads, so a find spanning a CRLF passes both.
    const crlfFind = sidecar(f.side, [
      {
        id: "eol",
        edits: [{ file: "src/crlf.txt", find: "1\r\nb", replace: "1\r\nc" }],
        test: "tests/a.test.ts",
        expect: "survives",
        why: "nothing reads it",
      },
    ]);
    await expect(
      mutate(opts(crlfFind, { check: true }), { cwd: f.dir, ...quiet }),
    ).resolves.toMatchObject({ unparsed: [] });
    for (const inPlace of [false, true]) {
      const rep = await withEnv({ MUTATE_FAKE_CRLF: "1" }, () =>
        mutate(opts(p, { inPlace }), { cwd: f.dir, ...quiet }),
      );
      expect(rep.results[0]?.result).toBe("survived");
    }
    expect(readFileSync(join(f.dir, "src", "crlf.txt"), "utf-8")).toBe("a = 1\r\nb = 2\r\n");
  });

  it("accepts a CRLF file committed under text=auto, and --check reads what the run reads", async () => {
    const f = fixture();
    writeFileSync(join(f.dir, "src", "v.txt"), "a = 1\r\nb = 2\r\n");
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "crlf"]);
    writeFileSync(join(f.dir, ".gitattributes"), "* text=auto\n");
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", ".gitattributes"]);
    sh(f.dir, "git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "auto"]);
    expect(status(f.dir)).toBe("");
    const p = sidecar(f.side, [
      {
        id: "b",
        edits: [{ file: "src/v.txt", find: "b = 2\r\n", replace: "b = 3\r\n" }],
        test: "tests/a.test.ts",
        expect: "survives",
        why: "nothing reads it",
      },
    ]);
    const check = await mutate(opts(p, { check: true }), { cwd: f.dir, ...quiet });
    expect(check.unparsed).toEqual([]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results[0]?.result).toBe("survived");
  });

  it("refuses a find or replace that is not well-formed Unicode", () => {
    expect(() =>
      validateSidecar([{ ...red, edits: [{ file: "a", find: "\uFFFD", replace: "\uD800" }] }]),
    ).toThrow(/replace is not well-formed Unicode/);
  });

  it("refuses a mutant whose edits cancel out", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      {
        id: "noop",
        edits: [
          { file: "src/value.txt", find: "pass", replace: "fail" },
          { file: "src/value.txt", find: "fail", replace: "pass" },
        ],
        test: "tests/a.test.ts",
        expect: "survives",
        why: "x",
      },
    ]);
    await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /noop: its edits cancel out/,
    );
  });

  it("removes the worktree when a signal lands during git worktree add", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    const handlers: Record<string, () => void> = {};
    const fakeProc = {
      on: (sig: string, h: () => void) => (handlers[sig] = h),
      off: () => {},
      exit: (code: number) => {
        throw new Error(`exit ${code}`);
      },
    };
    const real = makeRunner();
    const run = Object.assign(
      async (cmd: string, args: string[], o?: Parameters<typeof real>[2]) => {
        const r = await real(cmd, args, o);
        if (cmd === "git" && args[0] === "worktree" && args[1] === "add") handlers.SIGINT?.();
        return r;
      },
      { active: real.active },
    );
    await expect(
      mutate(opts(p), {
        cwd: f.dir,
        run,
        process: fakeProc as never,
        ...quiet,
      }),
    ).rejects.toThrow(/exit 130/);
    expect(worktrees(f.dir)).toBe(1);
  });

  it("refuses ids that differ only in case", () => {
    expect(() => validateSidecar([red, { ...red, id: "M1" }])).toThrow(/duplicate id/);
  });

  it("checks a .js file as the module type its package.json gives it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mutate-js-"));
    temps.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    mkdirSync(join(dir, "cjs"));
    writeFileSync(join(dir, "cjs", "package.json"), JSON.stringify({ type: "commonjs" }));
    const run = makeRunner();
    const esm = "export const a = 1;\n";
    expect(await syntaxError({ file: "a.js", text: esm, root: dir, run })).toBeNull();
    expect(await syntaxError({ file: "cjs/b.js", text: esm, root: dir, run })).toMatch(
      /SyntaxError/,
    );
    expect(await syntaxError({ file: "cjs/c.js", text: "return 1;\n", root: dir, run })).toBeNull();
  });

  it.each([
    ["SIGINT", 130, true],
    ["SIGINT", 130, false],
    ["SIGTERM", 143, false],
    ["SIGHUP", 129, true],
  ] as const)(
    "on %s (exit %i, in place: %s) restores, removes what it made and stops the test run",
    async (sig, exit, inPlace) => {
      const f = fixture();
      const p = sidecar(f.side, [toValue("hang", "hang")]);
      const tmp = mkdtempSync(join(tmpdir(), "mutate-tmp-"));
      temps.push(tmp);
      const child = spawn(process.execPath, [SCRIPT, p, ...(inPlace ? ["--in-place"] : [])], {
        cwd: f.dir,
        env: { ...process.env, MUTATE_FAKE_MARKER: f.marker, TMPDIR: tmp },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (c) => (stderr += c));
      const deadline = Date.now() + 30_000;
      while (!existsSync(f.marker) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(f.marker)).toBe(true);
      // In place, the mutant is in the checkout until the signal; in a worktree, never.
      expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe(
        inPlace ? "hang\n" : "pass\n",
      );
      const fakePid = Number(readFileSync(f.marker, "utf-8"));
      child.kill(sig);
      const code = await new Promise<number | null>((r) => child.on("close", r));
      expect(code, stderr).toBe(exit);
      expect(stderr).toContain(`stopped by ${sig}; files restored`);
      expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
      expect(status(f.dir)).toBe("");
      expect(worktrees(f.dir)).toBe(1);
      expect(readdirSync(tmp), "temp dir left behind").toEqual([]);
      // The killed run is reaped by init once its parent exits, so give it a moment.
      const alive = () => {
        try {
          process.kill(fakePid, 0);
        } catch {
          return false;
        }
        try {
          return !/^State:\s+Z/m.test(readFileSync(`/proc/${fakePid}/status`, "utf-8"));
        } catch {
          return true; // no /proc (macOS): the signal-0 answer stands
        }
      };
      const until = Date.now() + 15_000;
      while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      expect(alive(), `the killed test run (pid ${fakePid}) is still running`).toBe(false);
    },
  );

  it("exits 2 on a refusal, 1 when a mutant is not as expected, and 0 when all are", () => {
    const f = fixture();
    const bad = sidecar(f.side, [toValue("m", "fail", { expect: "survives" })]);
    const r1 = spawnSync(process.execPath, [SCRIPT, bad], { cwd: f.dir, encoding: "utf-8" });
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/refused: invalid sidecar/);
    const p = sidecar(f.side, [toValue("lives", "survive")]);
    const r2 = spawnSync(process.execPath, [SCRIPT, p], { cwd: f.dir, encoding: "utf-8" });
    expect(r2.status).toBe(1);
    expect(r2.stdout).toMatch(/unexpected=1/);
    const ok = sidecar(f.side, [toValue("kill", "fail")]);
    const r3 = spawnSync(process.execPath, [SCRIPT, ok], { cwd: f.dir, encoding: "utf-8" });
    expect(r3.status).toBe(0);
  });
});
