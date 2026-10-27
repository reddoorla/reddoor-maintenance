import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { extractArgs, formatResult } from "../../scripts/model-bakeoff/bakeoff.mjs";
import {
  finalScores,
  groupDisagreements,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";
import * as task from "../../scripts/model-bakeoff/tasks/t4-plan-task.mjs";
import { boxCommand, mountPoints } from "../../scripts/model-bakeoff/lib/box.mjs";

const { ALLOWED, HELD_OUT, heldOutResults, scopeCheck, truth } = task;

const passing = (names: string[]) => ({
  testResults: [
    {
      status: "passed",
      assertionResults: names.map((n) => ({
        ancestorTitles: ["hoverActivate"],
        title: n,
        status: "passed",
      })),
    },
  ],
});

describe("t4-plan-task scope", () => {
  it("passes a diff inside the task's files", () => {
    expect(scopeCheck(["src/lib/actions/hoverActivate.ts"], ALLOWED)).toEqual({
      pass: true,
      outside: [],
    });
  });

  it("fails a diff that touches any other file, and names it", () => {
    const r = scopeCheck(
      ["src/lib/actions/hoverActivate.ts", "tests/interaction/hover-activate.spec.ts", "notes.txt"],
      ALLOWED,
    );
    expect(r.pass).toBe(false);
    expect(r.outside).toEqual(["notes.txt", "tests/interaction/hover-activate.spec.ts"]);
  });

  it("fails an empty diff: nothing was implemented", () => {
    expect(scopeCheck([], ALLOWED).pass).toBe(false);
  });
});

describe("t4-plan-task held-out results", () => {
  const names = HELD_OUT.map((n: string) => n.replace(/^hoverActivate /, ""));

  it("reads every held-out test as passing when vitest says so", () => {
    expect(heldOutResults(passing(names)).every((t: { pass: boolean }) => t.pass)).toBe(true);
    expect(heldOutResults(passing(names)).map((t: { name: string }) => t.name)).toEqual(HELD_OUT);
  });

  it("reads a failing test as failing", () => {
    const report = passing(names);
    report.testResults[0]!.assertionResults[3]!.status = "failed";
    const r = heldOutResults(report);
    expect(
      r.filter((t: { pass: boolean }) => !t.pass).map((t: { name: string }) => t.name),
    ).toEqual([HELD_OUT[3]]);
  });

  it("reads a skipped or missing test as failing", () => {
    const report = passing(names.slice(1));
    report.testResults[0]!.assertionResults[0]!.status = "skipped";
    const r = heldOutResults(report);
    expect(r[0]!.pass).toBe(false);
    expect(r[1]!.pass).toBe(false);
    expect(r.slice(2).every((t: { pass: boolean }) => t.pass)).toBe(true);
  });

  it("reads a file that failed to load, or no report at all, as every test failing", () => {
    const report = { testResults: [{ status: "failed", assertionResults: [] }] };
    expect(heldOutResults(report).some((t: { pass: boolean }) => t.pass)).toBe(false);
    expect(heldOutResults(null).some((t: { pass: boolean }) => t.pass)).toBe(false);
  });
});

describe("t4-plan-task as a bake-off task", () => {
  it("has ten held-out tests and a truth where every gate and test passes", () => {
    expect(HELD_OUT).toHaveLength(10);
    const t = truth();
    expect(t.gates.map((g: { gate: string }) => g.gate)).toEqual([
      "typecheck",
      "lint",
      "suite",
      "own-tests",
      "scope",
    ]);
    expect([...t.gates, ...t.tests].every((x: { pass: boolean }) => x.pass)).toBe(true);
  });

  it("scores a failed gate mechanically, and sends a failed held-out test to the referee", () => {
    const out = truth();
    out.gates[4] = { gate: "scope", pass: false };
    const evidence = task.refereeEvidence("failed: AssertionError", "/w/a/repo", "/e/a/t.test.ts");
    out.tests[0] = { name: HELD_OUT[0]!, pass: false, result: evidence };
    const checks = scoreRun(task, truth(), out);
    expect(
      checks
        .filter((c) => !c.ok)
        .map((c) => c.check)
        .sort(),
    ).toEqual(["gates scope / pass", `tests ${HELD_OUT[0]} / result`]);
    expect(checks.filter((c) => c.collection === "gates").every((c) => c.mechanical)).toBe(true);
    const d = groupDisagreements({ arm: checks });
    expect(d.map((x) => x.check)).toEqual([`tests ${HELD_OUT[0]} / result`]);
    expect(d[0]!.armRaw).toContain("/w/a/repo/src/lib/actions/hoverActivate.ts");
    expect(d[0]!.armRaw).toContain("/e/a/t.test.ts");
    expect(task.refereeEvidence("passed", "/w", "/e")).toBe("passed");
  });

  it("carries a failing test's first message line, and names a test that never ran", () => {
    const report = passing(HELD_OUT.slice(1).map((n: string) => n.replace(/^hoverActivate /, "")));
    Object.assign(report.testResults[0]!.assertionResults[0]!, {
      status: "failed",
      failureMessages: ["AssertionError: expected [] to include x\u001b[90m\n    at stack"],
    });
    const r = heldOutResults(report);
    expect(r[0]!.result).toBe("not run");
    expect(r[1]!.result).toBe("failed: AssertionError: expected [] to include x");
    expect(r[2]!.result).toBe("passed");
  });

  it("refuses to build a run with an arm that names no effort", () => {
    expect(() => extractArgs(task, "/x/input")).not.toThrow();
    const arms = task.arms.map((a, i) =>
      i === 0 ? ({ id: a.id, model: a.model } as typeof a) : a,
    );
    expect(() => extractArgs(task, "/x/input", arms)).toThrow(/has no effort/);
  });

  it("names the plan's files in the prompt and keeps the original change out of it", () => {
    const p = task.prompt("/run/input");
    expect(p).toContain("/run/input/plan.md");
    for (const f of ALLOWED) expect(task.PLAN).toContain(f);
    for (const leak of ["8644d8c", "#253", task.IMPL]) {
      expect(p).not.toContain(leak);
      expect(task.PLAN).not.toContain(leak);
    }
  });
});

describe("cachedEvaluation", () => {
  it("evaluates each agent once, cached in the run", () => {
    const run = mkdtempSync(join(tmpdir(), "t4-"));
    const calls: string[] = [];
    const ev = (id: string) => task.cachedEvaluation(run, id, "k", () => (calls.push(id), { id }));
    expect(ev("gold")).toEqual({ id: "gold" });
    ev("a");
    ev("gold");
    ev("b");
    expect(calls).toEqual(["gold", "a", "b"]);
    expect(Object.keys(JSON.parse(readFileSync(join(run, "evaluated.json"), "utf8")))).toEqual([
      "gold",
      "a",
      "b",
    ]);
  });
  // A score run before an agent finished, or after the task's evaluate changed, must not keep
  // serving the old result (#1500).
  it("evaluates again when the key changes, and never caches an agent with no output yet", () => {
    const run = mkdtempSync(join(tmpdir(), "t4-"));
    let n = 0;
    const ev = (key: string | null) => task.cachedEvaluation(run, "a", key, () => ++n);
    expect([ev(null), ev(null)]).toEqual([1, 2]);
    expect(existsSync(join(run, "evaluated.json"))).toBe(false);
    expect([ev("k1"), ev("k1"), ev("k2"), ev("k2")]).toEqual([3, 3, 4, 4]);
  });

  it("evaluates again over an entry cached before the key existed", () => {
    const run = mkdtempSync(join(tmpdir(), "t4-"));
    writeFileSync(join(run, "evaluated.json"), JSON.stringify({ a: { gates: [] } }));
    expect(task.cachedEvaluation(run, "a", "k", () => "fresh")).toBe("fresh");
  });

  it("keys on the module, the transcript and the output, and gives no key without output", () => {
    const key = (s: unknown, t = "/t/a.jsonl", m = "m1") =>
      task.evaluationKey(s, { transcript: t }, m);
    expect(key(null)).toBeNull();
    expect(key(undefined)).toBeNull();
    const base = key({ notes: "x" });
    expect(key({ notes: "x" })).toBe(base);
    expect(
      new Set([
        base,
        key({ notes: "y" }),
        key({ notes: "x" }, "/t/b.jsonl"),
        key({ notes: "x" }, "/t/a.jsonl", "m2"),
      ]).size,
    ).toBe(4);
  });
});

describe("changedFiles", () => {
  const sh = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a]);

  it("finds every change against the scorer's own repo, whatever the agent's .git says", () => {
    const dir = mkdtempSync(join(tmpdir(), "t4-scope-"));
    const base = join(dir, "base");
    mkdirSync(join(base, "src"), { recursive: true });
    writeFileSync(join(base, "package.json"), '{"scripts":{"check":"svelte-check"}}\n');
    writeFileSync(join(base, "src", "a.ts"), "a\n");
    writeFileSync(join(base, "src", "gone.ts"), "g\n");
    writeFileSync(join(base, ".gitignore"), "node_modules\n");
    sh(base, "init", "-q");
    // A commit starts `git maintenance run --auto`, which git 2.47+ detaches: its
    // objects/maintenance.lock can vanish while cpSync walks .git, an ENOENT on CI (#1587's run).
    sh(base, "config", "gc.auto", "0");
    sh(base, "config", "maintenance.auto", "false");
    expect(sh(base, "config", "gc.auto").toString().trim()).toBe("0");
    expect(sh(base, "config", "maintenance.auto").toString().trim()).toBe("false");
    sh(base, "add", "-A");
    sh(base, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "pin");
    const tree = join(dir, "tree");
    cpSync(base, tree, { recursive: true });
    writeFileSync(join(tree, "package.json"), '{"scripts":{"check":"true"}}\n');
    sh(tree, "update-index", "--assume-unchanged", "package.json");
    const ran = join(dir, "fsmonitor-ran");
    sh(tree, "config", "core.fsmonitor", `touch ${ran}; false`);
    rmSync(join(tree, "src", "gone.ts"));
    writeFileSync(join(tree, "src", "new.ts"), "n\n");
    mkdirSync(join(tree, "node_modules"));
    writeFileSync(join(tree, "node_modules", "x.js"), "x\n");
    expect(task.changedFiles(base, tree)).toEqual(["package.json", "src/gone.ts", "src/new.ts"]);
    expect(existsSync(ran)).toBe(false);
  });

  it("finds a new .gitignore that hides itself and a stray file, and what base ignores stays out (#1499)", () =>
    withTmp("t4-scope-ignore-", (dir) => {
      const base = join(dir, "base");
      mkdirSync(join(base, "lib"), { recursive: true });
      writeFileSync(join(base, ".gitignore"), "node_modules\nbuild/\n");
      writeFileSync(join(base, "lib", ".gitignore"), "gen.txt\n");
      writeFileSync(join(base, "lib", "a.ts"), "a\n");
      sh(base, "init", "-q");
      sh(base, "add", "-A");
      sh(base, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "pin");
      const tree = join(dir, "tree");
      cpSync(base, tree, { recursive: true });
      mkdirSync(join(tree, "sub"));
      writeFileSync(join(tree, "sub", ".gitignore"), "*\n");
      writeFileSync(join(tree, "sub", "stray.ts"), "s\n");
      for (const f of ["node_modules/q/i.js", "build/o.js", "lib/gen.txt"]) {
        mkdirSync(dirname(join(tree, f)), { recursive: true });
        writeFileSync(join(tree, f), "x\n");
      }
      expect(task.changedFiles(base, tree)).toEqual(["sub/.gitignore", "sub/stray.ts"]);
    }));

  const pinRepo = (
    dir: string,
    files: Record<string, string>,
    links: Record<string, string> = {},
  ) => {
    const base = join(dir, "base");
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(base, f)), { recursive: true });
      writeFileSync(join(base, f), body);
    }
    for (const [l, to] of Object.entries(links)) symlinkSync(to, join(base, l));
    sh(base, "init", "-q");
    sh(base, "add", "-A");
    sh(base, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "pin");
    const tree = join(dir, "tree");
    cpSync(base, tree, { recursive: true, verbatimSymlinks: true });
    return { base, tree };
  };

  it("finds a path base re-includes with ! that a new .gitignore hides (#1781 review)", () =>
    withTmp("t4-scope-negate-", (dir) => {
      const { base, tree } = pinRepo(dir, {
        ".gitignore": "!.claude/\n.claude/*\n!.claude/settings.json\n",
        "a.ts": "a\n",
      });
      mkdirSync(join(tree, ".claude"));
      writeFileSync(join(tree, ".claude", "settings.json"), "{}\n");
      writeFileSync(join(tree, ".claude", ".gitignore"), "settings.json\n");
      expect(task.changedFiles(base, tree)).toEqual([".claude/settings.json"]);
    }));

  it("counts every hidden path, without stopping the score, when check-ignore fails (#1781 review)", () =>
    withTmp("t4-scope-link-", (dir) => {
      const { base, tree } = pinRepo(dir, { "real/x.ts": "x\n" }, { link: "real" });
      rmSync(join(tree, "link"));
      mkdirSync(join(tree, "link"));
      writeFileSync(join(tree, "link", ".gitignore"), "*\n");
      writeFileSync(join(tree, "link", "s.ts"), "s\n");
      expect(task.changedFiles(base, tree)).toEqual(["link", "link/.gitignore", "link/s.ts"]);
    }));
});

describe("refereed held-out tests", () => {
  it("never costs a passing arm when the referee says the plan does not require the test", () => {
    const failing = truth();
    failing.tests[0] = { name: HELD_OUT[0]!, pass: false, result: "failed: AssertionError" };
    const checksByArm = {
      passer: scoreRun(task, truth(), truth()),
      failer: scoreRun(task, truth(), failing),
    };
    const [d] = groupDisagreements(checksByArm);
    const rulings = { [d!.id]: { id: d!.id, armCorrect: true, refCorrect: false, note: "n" } };
    const { per, referenceErrors, referenceDisputes, contradictions } = finalScores(
      checksByArm,
      rulings,
    );
    expect(per.passer!.correct).toBe(32);
    expect(per.failer!.correct).toBe(32);
    expect(referenceErrors).toEqual([]);
    expect(contradictions).toEqual([]);
    // The ruling against a reference that is right by construction is reported, not lost (#1500).
    expect(referenceDisputes).toEqual([
      { check: `tests ${HELD_OUT[0]} / result`, reference: "passed", note: "n" },
    ]);
  });

  it("prints a reference dispute under the result table", () => {
    const text = formatResult({
      reference: "script truth",
      disagreements: 1,
      unruled: 0,
      arms: [],
      problems: [],
      referenceDisputes: [{ check: "tests t / result", reference: "passed", note: "n" }],
    });
    expect(text).toContain("- tests t / result: reference passed. n");
  });

  it("fails a test that never ran mechanically, without a referee", () => {
    const r = heldOutResults(null);
    expect(r.every((t: { mechanical?: boolean }) => t.mechanical)).toBe(true);
    const out = { ...truth(), tests: r };
    const checks = scoreRun(task, truth(), out);
    expect(checks.filter((c) => !c.ok)).toHaveLength(10);
    expect(groupDisagreements({ arm: checks })).toEqual([]);
    const failed = passing(HELD_OUT.map((n: string) => n.replace(/^hoverActivate /, "")));
    failed.testResults[0]!.assertionResults[0]!.status = "failed";
    expect(heldOutResults(failed)[0]).not.toHaveProperty("mechanical");
  });
});

describe("a held-out failure's disagreement id", () => {
  it("is short, names its arm, and keeps the evidence for the referee to read", () => {
    const one = (arm: string) => {
      const out = truth();
      out.tests[1] = {
        name: HELD_OUT[1]!,
        pass: false,
        result: task.refereeEvidence(
          "failed: AssertionError: expected [] to include x",
          `/r/eval/${arm}/tree`,
          `/r/eval/${arm}/tree/t.test.ts`,
        ),
      };
      return scoreRun(task, truth(), out);
    };
    const d = groupDisagreements({ a: one("haiku-1"), b: one("opus-low-1") });
    expect(d).toHaveLength(2);
    for (const x of d) expect(x.id.length).toBeLessThan(200);
    expect(d.map((x) => x.id)).toEqual([
      `tests ${HELD_OUT[1]} / result :: failed: AssertionError: expected [] to include x [haiku-1]`,
      `tests ${HELD_OUT[1]} / result :: failed: AssertionError: expected [] to include x [opus-low-1]`,
    ]);
    expect(d[0]!.armRaw).toContain("/r/eval/haiku-1/tree/src/lib/actions/hoverActivate.ts");
  });
});

describe("item-level mechanical", () => {
  it("is ignored in an agent's own report, where it would hide a wrong reference", () => {
    const spec = { collections: task.collections, kinds: task.kinds };
    const out = { ...truth(), tests: heldOutResults(null) };
    const checks = scoreRun(spec, truth(), out);
    const results = checks.filter((c) => c.field === "result");
    expect(results).toHaveLength(10);
    expect(results.filter((c) => c.mechanical)).toEqual([]);
  });
});

describe("the agent's own tests", () => {
  const file = (status: string, tests: string[]) => ({
    status,
    assertionResults: tests.map((t) => ({ status: t })),
  });

  it("pass when the file ran, one test at least passed, and none failed", () => {
    expect(task.ownTestsPass({ testResults: [file("passed", ["passed", "skipped"])] })).toBe(true);
  });

  it("fail when missing, empty, failing, or the file did not load", () => {
    expect(task.ownTestsPass(null)).toBe(false);
    expect(task.ownTestsPass({ testResults: [] })).toBe(false);
    expect(task.ownTestsPass({ testResults: [file("passed", ["skipped"])] })).toBe(false);
    expect(task.ownTestsPass({ testResults: [file("failed", ["passed", "failed"])] })).toBe(false);
    expect(task.ownTestsPass({ testResults: [file("failed", [])] })).toBe(false);
  });
});

describe("a gate step", () => {
  it("fails, without stopping the score, when the agent's code never returns", () => {
    const r = task.run(tmpdir(), process.execPath, ["-e", "while (true) {}"], 500);
    expect(r.status).toBeNull();
    expect(r.error).toBe("ETIMEDOUT");
  });

  it("stops the score when the harness's own binary is missing", () => {
    expect(() => task.run(tmpdir(), "no-such-binary-t4", [])).toThrow(/not found/);
  });
});

describe("the scorer's git", () => {
  it("runs no filter from the caller's global config on the agent's files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "t4-home-"));
    const ran = join(dir, "filter-ran");
    writeFileSync(join(dir, ".gitconfig"), `[filter "evil"]\n\tclean = touch ${ran}; cat\n`);
    const home = process.env.HOME;
    process.env.HOME = dir;
    vi.resetModules();
    try {
      const fresh = await import("../../scripts/model-bakeoff/tasks/t4-plan-task.mjs");
      const base = join(dir, "base");
      mkdirSync(base);
      writeFileSync(join(base, "a.ts"), "a\n");
      execFileSync("git", ["-C", base, "init", "-q"]);
      execFileSync("git", ["-C", base, "add", "-A"]);
      execFileSync(
        "git",
        ["-C", base, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "p"],
        {
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
        },
      );
      const tree = join(dir, "tree");
      mkdirSync(tree);
      writeFileSync(join(tree, "a.ts"), "b\n");
      writeFileSync(join(tree, ".gitattributes"), "* filter=evil\n");
      expect(fresh.changedFiles(base, tree)).toEqual([".gitattributes", "a.ts"]);
      expect(existsSync(ran)).toBe(false);
    } finally {
      process.env.HOME = home;
      vi.resetModules();
    }
  });
});

// A temp dir for one test, removed afterwards (the flood test writes 4,600 files).
function withTmp(prefix: string, fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the own-tests gate", () => {
  const report = { testResults: [{ status: "passed", assertionResults: [{ status: "passed" }] }] };

  it("needs vitest to exit 0 as well as a passing report (#1496)", () => {
    expect(task.ownTestsGate({ status: 0 }, report)).toBe(true);
    // An unhandled error makes vitest exit 1 while its JSON report still says passed.
    expect(task.ownTestsGate({ status: 1 }, report)).toBe(false);
    expect(task.ownTestsGate({ status: null, error: "ETIMEDOUT" }, report)).toBe(false);
    expect(task.ownTestsGate(null, report)).toBe(false);
    expect(task.ownTestsGate({ status: 0 }, null)).toBe(false);
  });

  it("accepts a todo test beside a passing one, but not one that never finished (#1496)", () => {
    const file = (tests: string[]) => ({
      testResults: [{ status: "passed", assertionResults: tests.map((status) => ({ status })) }],
    });
    expect(task.ownTestsPass(file(["passed", "todo"]))).toBe(true);
    expect(task.ownTestsPass(file(["todo"]))).toBe(false);
    // vitest's JSON reporter writes "pending" for a test still run, only or queued.
    expect(task.ownTestsPass(file(["passed", "pending"]))).toBe(false);
  });
});

describe("scoring evaluate's runs", () => {
  const done = { status: 0, stdout: "", stderr: "" };
  const passing = {
    testResults: [{ status: "passed", assertionResults: [{ status: "passed" }] }],
  };
  const runs = (o: Partial<Parameters<typeof task.scoreRuns>[0]>) =>
    task.scoreRuns({
      changed: ["src/lib/actions/hoverActivate.ts"],
      scope: { pass: true, outside: [] },
      check: done,
      lint: done,
      suite: done,
      ownRun: done,
      ownReport: passing,
      heldRun: done,
      report: null,
      held: "/e/held",
      ...o,
    });
  const gate = (r: ReturnType<typeof runs>, g: string) => r.gates.find((x) => x.gate === g)!.pass;

  it("fails own-tests when vitest exits 1 on a passing report (#1496)", () => {
    expect(gate(runs({}), "own-tests")).toBe(true);
    expect(gate(runs({ ownRun: { status: 1 } }), "own-tests")).toBe(false);
  });

  it("records a held-out run that timed out (#1497)", () => {
    const r = runs({ heldRun: { status: null, error: "ETIMEDOUT" } });
    expect(r.detail.heldOutError).toBe("ETIMEDOUT");
    expect(runs({}).detail).not.toHaveProperty("heldOutError");
  });
});

describe("a vitest JSON report", () => {
  it("reads as null when it is missing or half-written (#1497)", () =>
    withTmp("t4-report-", (dir) => {
      const f = join(dir, "r.json");
      expect(task.readReport(f)).toBeNull();
      writeFileSync(f, '{"testResults":[{"status":"pas');
      expect(task.readReport(f)).toBeNull();
      writeFileSync(f, '{"testResults":[]}');
      expect(task.readReport(f)).toEqual({ testResults: [] });
    }));
});

describe("the scope gate on a flood of changes (#1497)", () => {
  it("lists more than 1 MiB of untracked paths", () =>
    withTmp("t4-flood-", (dir) => {
      const base = join(dir, "base");
      mkdirSync(base);
      writeFileSync(join(base, "a.ts"), "a\n");
      execFileSync("git", ["-C", base, "init", "-q"]);
      execFileSync("git", ["-C", base, "add", "-A"]);
      execFileSync("git", [
        "-C",
        base,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-qm",
        "p",
      ]);
      const tree = join(dir, "tree");
      mkdirSync(join(tree, "c"), { recursive: true });
      writeFileSync(join(tree, "a.ts"), "a\n");
      const n = 4600; // 4600 x ~240 bytes is over execFileSync's default 1 MiB
      for (let i = 0; i < n; i++) writeFileSync(join(tree, "c", `${"f".repeat(230)}-${i}`), "");
      expect(task.changedFiles(base, tree)).toHaveLength(n);
    }));

  it("fails scope, without stopping the score, when git's output still overflows", () => {
    const flood = () => execFileSync("git", ["--version"], { maxBuffer: 1 }).toString().split("\n");
    const changed = task.changedOrFlood("/b", "/t", flood);
    expect(changed).toEqual(["<too many changes>"]);
    expect(scopeCheck(changed).pass).toBe(false);
    const missing = () => execFileSync("no-such-binary-t4").toString().split("\n");
    expect(() => task.changedOrFlood("/b", "/t", missing)).toThrow(/ENOENT/);
  });
});

describe("copying the plan's files into an eval tree (#1499)", () => {
  const pinned = (to: string) => {
    mkdirSync(join(to, "src", "lib", "actions"), { recursive: true });
    writeFileSync(join(to, "src", "lib", "actions", "hoverActivate.ts"), "pinned\n");
  };

  it("refuses a file reached through a symlinked parent directory", () =>
    withTmp("t4-link-", (dir) => {
      const outside = join(dir, "reference", "actions");
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "hoverActivate.ts"), "reference\n");
      const repo = join(dir, "repo");
      mkdirSync(join(repo, "src", "lib", "components"), { recursive: true });
      writeFileSync(join(repo, "src", "lib", "components", "PropertyListing.svelte"), "agent\n");
      symlinkSync(join(dir, "reference", "actions"), join(repo, "src", "lib", "actions"));
      const to = join(dir, "tree");
      pinned(to);
      task.copyPlanFiles(repo, to);
      expect(existsSync(join(to, "src", "lib", "actions", "hoverActivate.ts"))).toBe(false);
      expect(
        readFileSync(join(to, "src", "lib", "components", "PropertyListing.svelte"), "utf8"),
      ).toBe("agent\n");
    }));

  it("removes the plan's files, without stopping the score, when the repo is gone", () =>
    withTmp("t4-gone-", (dir) => {
      const to = join(dir, "tree");
      pinned(to);
      expect(() => task.copyPlanFiles(join(dir, "repo"), to)).not.toThrow();
      expect(existsSync(join(to, "src", "lib", "actions", "hoverActivate.ts"))).toBe(false);
    }));
});

describe("the evidence key (#1502)", () => {
  it("keys on the arm's own eval dir when the run dir also contains /eval/<x>/tree/", () => {
    const key = (arm: string) => {
      const held = `/runs/eval/old/tree/r1/eval/${arm}/held`;
      return task.kinds.evidence!(
        task.refereeEvidence("failed: boom", held, `${held}/src/lib/actions/hoverActivate.test.ts`),
      );
    };
    expect(key("haiku-1")).toBe("failed: boom [haiku-1]");
    expect(key("opus-low-1")).toBe("failed: boom [opus-low-1]");
  });
});

describe("the scorer's pnpm (#1498)", () => {
  // An agent can write the caller's pnpm config with Bash. Neither the hook nor the shell they name
  // may run inside the scorer: not on its install, and not on a gate's `pnpm <script>`.
  it("reads no hook or script-shell from the caller's pnpm config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "t4-pnpmrc-"));
    {
      const ran = (what: string) => join(dir, `${what}-ran`);
      writeFileSync(
        join(dir, "hook.cjs"),
        `require("fs").writeFileSync(${JSON.stringify(ran("hook"))}, "")\n`,
      );
      writeFileSync(join(dir, "shell.sh"), `#!/bin/sh\ntouch ${ran("shell")}\n`, { mode: 0o755 });
      const rc = `global-pnpmfile=${join(dir, "hook.cjs")}\nscript-shell=${join(dir, "shell.sh")}\n`;
      const home = join(dir, "home");
      mkdirSync(join(home, ".config", "pnpm"), { recursive: true });
      writeFileSync(join(home, ".npmrc"), rc);
      writeFileSync(join(home, ".config", "pnpm", "rc"), rc);
      // pnpm 11 reads its global settings from config.yaml, pnpm 10 from the rc files.
      writeFileSync(
        join(home, ".config", "pnpm", "config.yaml"),
        `globalPnpmfile: ${join(dir, "hook.cjs")}\nscriptShell: ${join(dir, "shell.sh")}\n`,
      );
      const proj = join(dir, "proj");
      mkdirSync(proj);
      writeFileSync(
        join(proj, "package.json"),
        '{"name":"p","version":"1.0.0","scripts":{"x":"true"}}\n',
      );
      // The lockfile is made with no rc at all, as the pin's is.
      execFileSync("pnpm", ["install", "--offline"], {
        cwd: proj,
        env: { ...process.env, HOME: join(dir, "clean"), XDG_CONFIG_HOME: join(dir, "clean") },
      });
      const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
      process.env.HOME = home;
      process.env.XDG_CONFIG_HOME = join(home, ".config");
      vi.resetModules();
      try {
        const fresh = await import("../../scripts/model-bakeoff/tasks/t4-plan-task.mjs");
        expect(fresh.install(proj).status).toBe(0);
        expect(fresh.run(proj, "pnpm", ["run", "x"]).status).toBe(0);
        expect(existsSync(ran("hook"))).toBe(false);
        expect(existsSync(ran("shell"))).toBe(false);
      } finally {
        process.env.HOME = saved.HOME;
        if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = saved.XDG;
        vi.resetModules();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    // Three pnpm processes.
  }, 30_000);

  it("gives each step a config directory of its own, which one step's code cannot leave behind", () =>
    withTmp("t4-pnpm-step-", (dir) => {
      const plant = `mkdir -p "$XDG_CONFIG_HOME/pnpm" && echo planted > "$XDG_CONFIG_HOME/pnpm/config.yaml" && echo "$XDG_CONFIG_HOME"`;
      const first = task.run(dir, "sh", ["-c", plant]).stdout.trim();
      expect(existsSync(first)).toBe(false);
      const second = task.run(dir, "sh", [
        "-c",
        'echo "$XDG_CONFIG_HOME"; ls -A "$XDG_CONFIG_HOME"',
      ]);
      expect(second.stdout.trim()).not.toContain(first);
      expect(second.stdout.trim().split("\n")).toHaveLength(1);
    }));
});

describe("the scorer's snapshot of the pin (#1498)", () => {
  it("runs no filter driver from the --root clone's own config or info/attributes", () =>
    withTmp("t4-root-filter-", (dir) => {
      const root = join(dir, "root");
      mkdirSync(root);
      const sh = (...a: string[]) =>
        execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...a], {
          encoding: "utf8",
        }).trim();
      sh("init", "-q");
      writeFileSync(join(root, "a.ts"), "a\n");
      sh("add", "-A");
      sh("commit", "-qm", "pin");
      const pin = sh("rev-parse", "HEAD");
      const ran = join(dir, "filter-ran");
      sh("config", "filter.evil.smudge", `touch ${ran}; cat`);
      mkdirSync(join(root, ".git", "info"), { recursive: true });
      writeFileSync(join(root, ".git", "info", "attributes"), "* filter=evil\n");
      const to = join(dir, "out");
      task.snapshot(root, pin, to);
      expect(readFileSync(join(to, "a.ts"), "utf8")).toBe("a\n");
      expect(existsSync(ran)).toBe(false);
    }));
});

describe("the gates' box (#1501, Linux only)", () => {
  it("refuses a box that would hide a writable directory or its ancestor", () => {
    expect(() =>
      boxCommand({ hide: ["/r/eval"], writable: ["/r/eval/a/tree"] }, "true", []),
    ).toThrow(/would hide \/r\/eval, which holds its writable \/r\/eval\/a\/tree/);
    expect(() => boxCommand({ hide: ["/r/x"], writable: ["/r/x"] }, "true", [])).toThrow(
      /would hide/,
    );
    const [cmd, args] = boxCommand({ hide: ["/r/eval/b"], writable: ["/r/eval/a"] }, "true", []);
    expect(cmd).toBe("unshare");
    // Every path is an argument in a JSON spec, never shell text.
    expect(JSON.parse(args.at(-1)!)).toEqual({
      hide: ["/r/eval/b"],
      writable: ["/r/eval/a"],
      cmd: "true",
      args: [],
    });
  });

  it("reads mount points with their escapes decoded", () => {
    const text = "22 1 0:21 / / rw - ext4 /dev/vda rw\n23 22 0:5 / /a\\040b rw - tmpfs t rw\n";
    expect(mountPoints(text)).toEqual(["/", "/a b"]);
  });

  it("hides the root clone, the agents' repos, the other arms, earlier runs and answer files", () =>
    withTmp("t4-hide-", (dir) => {
      const runDir = join(dir, "run");
      for (const d of ["eval/a", "eval/b", "eval/c", "work/a/repo", "input"])
        mkdirSync(join(runDir, d), { recursive: true });
      for (const f of ["t4.json", "evaluated.json", "workflow-args.json"])
        writeFileSync(join(runDir, f), "{}");
      for (const k of ["truth", "runs", "result"]) writeFileSync(`${runDir}.${k}.json`, "{}");
      // An earlier run beside this one, and a directory that is not a run.
      mkdirSync(join(dir, "old", "eval", "x", "held"), { recursive: true });
      writeFileSync(join(dir, "old", "workflow-args.json"), "{}");
      writeFileSync(join(dir, "old.truth.json"), "{}");
      mkdirSync(join(dir, "notes"));
      const root = join(dir, "root");
      mkdirSync(root);
      expect(task.hiddenFrom(runDir, "a", root).sort()).toEqual(
        [
          root,
          join(runDir, "work"),
          join(runDir, "eval", "b"),
          join(runDir, "eval", "c"),
          `${runDir}.truth.json`,
          `${runDir}.runs.json`,
          `${runDir}.result.json`,
          join(runDir, "t4.json"),
          join(runDir, "evaluated.json"),
          join(dir, "old"),
          join(dir, "old.truth.json"),
        ].sort(),
      );
    }));

  it("records whether the gates ran boxed", () => {
    const r = (status: number) => ({ status, stdout: "", stderr: "" });
    const runs = {
      changed: ["a"],
      scope: { pass: true, outside: [] },
      check: r(0),
      lint: r(0),
      suite: r(0),
      ownRun: r(0),
      ownReport: null,
      heldRun: r(0),
      report: null,
      held: "/h",
    };
    expect(task.scoreRuns({ ...runs, boxed: true }).detail.gatesSandboxed).toBe(true);
    expect(task.scoreRuns({ ...runs, boxed: false }).detail.gatesSandboxed).toBe(false);
  });

  // Where unshare cannot build a box (macOS, a runner that restricts user namespaces), the gates
  // run unboxed and record it, so there is no box here to test (the operator, 2026-10-26).
  describe.runIf(task.sandboxAvailable())("where a box can be built", () => {
    const dns = `node -e "require('dns').lookup('registry.npmjs.org',e=>console.log(e?'no-network':'NETWORK'))"`;

    it("hides, confines and cuts the network, and the command cannot undo it", () =>
      withTmp("t4-box-", (dir) => {
        const keep = join(dir, "keep");
        const tmp = join(dir, "tmp");
        const secretDir = join(dir, "secret");
        const secretFile = join(dir, "truth.json");
        const outside = join(dir, "outside");
        for (const d of [keep, tmp, secretDir, outside]) mkdirSync(d);
        writeFileSync(join(secretDir, "key"), "answer");
        writeFileSync(secretFile, "answer");
        const mark = `t4-box-${process.pid}-${Date.now()}`;
        const probe = [
          `cat ${secretDir}/key ${secretFile} 2>/dev/null; echo "[read]"`,
          `umount ${secretDir} 2>/dev/null; umount ${secretFile} 2>/dev/null; cat ${secretDir}/key ${secretFile} 2>/dev/null; echo "[after umount]"`,
          `mount -o remount,rw / 2>/dev/null && echo REMOUNTED || echo no-remount`,
          `touch ${keep}/w && echo kept-writable`,
          `touch "$TMPDIR/w" && [ "$TMPDIR" = ${tmp} ] && echo tmp-is-${"$"}{TMPDIR##*/}`,
          `touch ${outside}/w 2>/dev/null && echo OUTSIDE-WRITABLE || echo outside-read-only`,
          `touch ${secretDir}/w 2>/dev/null && echo SECRET-WRITABLE || echo secret-read-only`,
          `touch /dev/shm/${mark} /dev/${mark} 2>/dev/null; echo "[dev]"`,
          `[ "$(ls /proc | grep -cE '^[0-9]+$')" -lt 10 ] && echo own-proc || echo HOST-PROC`,
          dns,
        ].join("; ");
        const box = { hide: [secretDir, secretFile], writable: [keep, tmp], tmp };
        const r = task.run(dir, "sh", ["-c", probe], 60_000, box);
        // The control: outside the box the same lookup resolves, or "no-network" proves nothing.
        const control = task.run(dir, "sh", ["-c", dns]).stdout.trim();
        expect(control).toBe("NETWORK");
        expect(r.stdout.split("\n").filter(Boolean)).toEqual([
          "[read]",
          "[after umount]",
          "no-remount",
          "kept-writable",
          "tmp-is-tmp",
          "outside-read-only",
          "secret-read-only",
          "[dev]",
          "own-proc",
          "no-network",
        ]);
        expect(readFileSync(secretFile, "utf8")).toBe("answer");
        // A box's /dev/shm is its own, and /dev is read-only: neither reaches the host.
        expect(existsSync(`/dev/shm/${mark}`)).toBe(false);
        expect(existsSync(`/dev/${mark}`)).toBe(false);
      }));

    // pnpm's pre-run dependency check installs when it finds the install stale (here, a manifest
    // edited after it, as an agent can edit its own tree), and an install cannot work in the box.
    it(
      "runs pnpm on a project whose install is stale, with the check off",
      () =>
        withTmp("t4-box-pnpm-", (dir) => {
          const dep = join(dir, "dep");
          const proj = join(dir, "proj");
          const tmp = join(dir, "tmp");
          for (const d of [dep, proj, tmp]) mkdirSync(d);
          writeFileSync(join(dep, "package.json"), '{"name":"dep","version":"1.0.0"}');
          const pkg = { name: "p", version: "1.0.0", scripts: { x: "echo ran-x" } };
          writeFileSync(
            join(proj, "package.json"),
            JSON.stringify({ ...pkg, dependencies: { dep: "file:../dep" } }),
          );
          // Into a store of the test's own: no registry, no cache.
          const store = `--config.store-dir=${join(dir, "store")}`;
          expect(task.run(proj, "pnpm", ["install", "--offline", store]).status).toBe(0);
          writeFileSync(
            join(proj, "package.json"),
            JSON.stringify({ ...pkg, dependencies: { dep: "link:../dep" } }),
          );
          const r = task.run(proj, "pnpm", ["run", "x"], 60_000, {
            hide: [],
            writable: [proj, tmp],
            tmp,
          });
          expect(r.stdout + r.stderr).toContain("ran-x");
          expect(r.status).toBe(0);
        }),
      120_000,
    );

    it(
      "stops a boxed step at its timeout, with nothing left running",
      () =>
        withTmp("t4-box-hang-", (dir) => {
          const mark = String(4000 + (process.pid % 1000));
          const t0 = Date.now();
          const r = task.run(dir, "sh", ["-c", `sleep ${mark}`], 3000, {
            hide: [],
            writable: [dir],
            tmp: dir,
          });
          expect(Date.now() - t0).toBeLessThan(15_000);
          expect(r.error).toBe("ETIMEDOUT");
          const left = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
          expect(left.split("\n").filter((l) => l.trim() === `sleep ${mark}`)).toEqual([]);
        }),
      30_000,
    );

    it("keeps a writable directory writable when its path runs through a symlink", () =>
      withTmp("t4-box-link-", (dir) => {
        const real = join(dir, "real");
        mkdirSync(join(real, "keep"), { recursive: true });
        mkdirSync(join(real, "tmp"));
        symlinkSync(real, join(dir, "link"));
        const keep = join(dir, "link", "keep");
        const tmp = join(dir, "link", "tmp");
        const r = task.run(dir, "sh", ["-c", `touch ${keep}/w && echo ok`], 30_000, {
          hide: [],
          writable: [keep, tmp],
          tmp,
        });
        expect(r.stdout.trim()).toBe("ok");
      }));
  });
});
