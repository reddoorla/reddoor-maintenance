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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  validateSidecar,
  countMatches,
  applyEdits,
  classifyRun,
  asExpected,
  mutate,
  formatReport,
  Refusal,
  type Options,
} from "../../scripts/mutate.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/mutate.mjs", import.meta.url));

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
  it("counts without overlaps", () => {
    expect(countMatches("aaaa", "aa")).toBe(2);
    expect(countMatches("abc", "d")).toBe(0);
  });
});

describe("classifyRun", () => {
  const file = (status: string, cases: string[], message = "") => ({
    name: "/r/tests/a.test.ts",
    status,
    message,
    assertionResults: cases.map((s) => ({ status: s })),
  });
  it("counts red only when a test case failed", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", ["failed", "passed"])] } }),
    ).toMatchObject({
      result: "red",
      failed: 1,
      total: 2,
    });
  });
  it("calls a load failure stillborn, not a kill", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("failed", [], "Cannot find module")] } }),
    ).toMatchObject({ result: "stillborn", reason: "failed to load: tests/a.test.ts" });
  });
  it("calls a timeout, a missing report and a run with no cases stillborn", () => {
    expect(classifyRun({ code: 1, timedOut: true, report: null }).result).toBe("stillborn");
    expect(classifyRun({ code: 1, report: null }).reason).toMatch(/no vitest report/);
    expect(classifyRun({ code: 0, report: { testResults: [] } }).reason).toBe("no test cases ran");
  });
  it("calls a non-zero exit with every case passing stillborn", () => {
    expect(
      classifyRun({ code: 1, report: { testResults: [file("passed", ["passed"])] } }).result,
    ).toBe("stillborn");
  });
  it("calls every case passing on a clean exit survived", () => {
    expect(
      classifyRun({ code: 0, report: { testResults: [file("passed", ["passed"])] } }).result,
    ).toBe("survived");
  });
  it("still counts a failed case red when another file failed to load, and says so", () => {
    const c = classifyRun({
      code: 1,
      report: {
        testResults: [
          file("failed", ["failed"]),
          { ...file("failed", [], "boom"), name: "/r/tests/b.test.ts" },
        ],
      },
    });
    expect(c).toMatchObject({ result: "red", reason: "also failed to load: tests/b.test.ts" });
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
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const files = args.filter((a) => a.startsWith("tests/"));
const from = process.env.MUTATE_FAKE_READ || "src/value.txt";
const value = existsSync(from) ? readFileSync(from, "utf-8").trim() : "missing";
if (process.env.MUTATE_FAKE_LOG) appendFileSync(process.env.MUTATE_FAKE_LOG, process.cwd() + " " + value + "\\n");
const report = (cases, extra = {}) => ({
  testResults: files.map((f) => ({ name: process.cwd() + "/" + f, status: cases.includes("failed") || extra.message ? "failed" : "passed", message: extra.message || "", assertionResults: cases.map((status) => ({ status })) })),
});
if (value === "hang") {
  writeFileSync(process.env.MUTATE_FAKE_MARKER, String(process.pid));
  setInterval(() => {}, 1000);
} else if (value === "fail") {
  writeFileSync(out, JSON.stringify(report(["failed", "passed"]))); process.exit(1);
} else if (value === "load") {
  writeFileSync(out, JSON.stringify(report([], { message: "Cannot find module" }))); process.exit(1);
} else if (value === "nojson") {
  process.exit(1);
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

/** A committed repo with src/value.txt = "pass", a test file, and the fake vitest. */
function fixture(value = "pass") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutate-fixture-")));
  temps.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "src", "value.txt"), `${value}\n`);
  writeFileSync(join(dir, "tests", "a.test.ts"), "// read by the fake vitest only\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\ndist/\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      private: true,
      scripts: {
        build:
          "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').copyFileSync('src/value.txt','dist/value.txt')\"",
      },
    }),
  );
  writeFileSync(join(dir, "node_modules", "fake-vitest.mjs"), FAKE_VITEST);
  const bin = join(dir, "node_modules", ".bin", "vitest");
  writeFileSync(bin, `#!/bin/sh\nexec node "$(dirname "$0")/../fake-vitest.mjs" "$@"\n`);
  chmodSync(bin, 0o755);
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

describe("mutate, against a real repo", () => {
  it("runs the unmutated test first, then each mutant in a throwaway worktree, and leaves nothing behind", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("kill", "fail"),
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
    const runs = readFileSync(f.log, "utf-8").trim().split("\n");
    expect(runs.map((l) => l.split(" ")[1])).toEqual(["pass", "fail", "survive"]);
    expect(runs.every((l) => !l.startsWith(f.dir + " "))).toBe(true);
    expect(status(f.dir)).toBe("");
    expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
    expect(worktrees(f.dir)).toBe(1);
    expect(readdirSync(tmp)).toEqual([]);
    expect(rep.sha).toBe(sh(f.dir, "git", ["rev-parse", "HEAD"]).trim());
    const table = formatReport(rep);
    expect(table).toMatch(/^MUTATE_SUMMARY mutants=2 red=1 survived=1 stillborn=0 unexpected=0 /);
    expect(table).toContain(`At \`${rep.sha}\``);
    expect(table).toContain(
      "| keep | survives | survived | 0 / 2 | `tests/a.test.ts` | a second layer |",
    );
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
        /unmutated run of tests\/a\.test\.ts did not pass \(red, 1 failed\)/,
      );
    });
    expect(readFileSync(f.log, "utf-8").trim().split("\n")).toHaveLength(1);
    expect(worktrees(f.dir)).toBe(1);
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

  it("refuses an edit to a file git does not track", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      { ...toValue("m", "fail"), edits: [{ file: "src/none.txt", find: "a", replace: "b" }] },
    ]);
    await expect(mutate(opts(p), { cwd: f.dir, ...quiet })).rejects.toThrow(
      /does not track: src\/none\.txt/,
    );
  });

  it("reports a load failure, a crash with no report and an unexpected survivor as not ok", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("load", "load"),
      toValue("crash", "nojson"),
      toValue("lives", "survive"),
    ]);
    const rep = await mutate(opts(p), { cwd: f.dir, ...quiet });
    expect(rep.results.map((r) => [r.id, r.result, r.ok])).toEqual([
      ["load", "stillborn", false],
      ["crash", "stillborn", false],
      ["lives", "survived", false],
    ]);
    expect(formatReport(rep)).toContain("| lives | red | **survived** (unexpected) |");
    expect(status(f.dir)).toBe("");
  });

  it("restores the file in place with --in-place", async () => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("kill", "fail")]);
    await withEnv({ MUTATE_FAKE_LOG: f.log }, async () => {
      const rep = await mutate(opts(p, { inPlace: true }), { cwd: f.dir, ...quiet });
      expect(rep.mode).toBe("in-place");
      expect(rep.results[0]?.result).toBe("red");
    });
    expect(readFileSync(f.log, "utf-8").trim().split("\n")).toEqual([
      `${f.dir} pass`,
      `${f.dir} fail`,
    ]);
    expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
    expect(status(f.dir)).toBe("");
  });

  it("rebuilds before the test when the mutant says build, and only then", async () => {
    const f = fixture();
    const p = sidecar(f.side, [
      toValue("built", "fail", { build: true }),
      toValue("stale", "fail", { expect: "survives", why: "dist is not rebuilt" }),
    ]);
    const rep = await withEnv({ MUTATE_FAKE_READ: "dist/value.txt" }, () =>
      mutate(opts(p, { only: ["built"] }), { cwd: f.dir, ...quiet }),
    );
    expect(rep.results.map((r) => [r.id, r.result])).toEqual([["built", "red"]]);
    const rep2 = await withEnv({ MUTATE_FAKE_READ: "dist/value.txt" }, () =>
      mutate(opts(p), { cwd: f.dir, ...quiet }),
    );
    // "stale" does not build, so it reads dist; it survives only if dist was rebuilt
    // unmutated after "built", rather than still holding "built"'s output.
    expect(rep2.results.map((r) => [r.id, r.result])).toEqual([
      ["built", "red"],
      ["stale", "survived"],
    ]);
  });

  it.each([
    ["in place", true],
    ["in a worktree", false],
  ])("restores and cleans up on SIGINT %s, and stops the test run", async (_, inPlace) => {
    const f = fixture();
    const p = sidecar(f.side, [toValue("hang", "hang")]);
    const child = spawn(process.execPath, [SCRIPT, p, ...(inPlace ? ["--in-place"] : [])], {
      cwd: f.dir,
      env: { ...process.env, MUTATE_FAKE_MARKER: f.marker },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 30_000;
    while (!existsSync(f.marker) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(f.marker)).toBe(true);
    if (inPlace) expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("hang\n");
    const fakePid = Number(readFileSync(f.marker, "utf-8"));
    child.kill("SIGINT");
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code).toBe(130);
    expect(stderr).toMatch(/stopped by SIGINT; files restored/);
    expect(readFileSync(join(f.dir, "src", "value.txt"), "utf-8")).toBe("pass\n");
    expect(status(f.dir)).toBe("");
    expect(worktrees(f.dir)).toBe(1);
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
    const until = Date.now() + 5_000;
    while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    expect(alive()).toBe(false);
  });

  it("exits 2 from the CLI on a refusal and 1 when a mutant is not as expected", () => {
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
