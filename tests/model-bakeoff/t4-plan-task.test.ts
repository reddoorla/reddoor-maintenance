import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  evaluatedOutputs,
  extractArgs,
  referenceFor,
} from "../../scripts/model-bakeoff/bakeoff.mjs";
import {
  finalScores,
  groupDisagreements,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";
import * as task from "../../scripts/model-bakeoff/tasks/t4-plan-task.mjs";

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
      "scope",
    ]);
    expect([...t.gates, ...t.tests].every((x: { pass: boolean }) => x.pass)).toBe(true);
  });

  it("scores a failed gate mechanically, and sends a failed held-out test to the referee", () => {
    const out = truth();
    out.gates[3] = { gate: "scope", pass: false };
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

describe("evaluatedOutputs", () => {
  it("scores what each agent left on disk, once per agent, cached in the run", () => {
    const run = mkdtempSync(join(tmpdir(), "t4-"));
    const calls: string[] = [];
    const fake = {
      evaluate: ({ id, work }: { id: string; work: string }) => {
        calls.push(id);
        return { id, work };
      },
    };
    const args = { work: `${run}/work` };
    expect(evaluatedOutputs(fake, run, args, ["gold", "a"])).toEqual({
      gold: { id: "gold", work: `${run}/work` },
      a: { id: "a", work: `${run}/work` },
    });
    evaluatedOutputs(fake, run, args, ["gold", "a", "b"]);
    expect(calls).toEqual(["gold", "a", "b"]);
    expect(Object.keys(JSON.parse(readFileSync(join(run, "evaluated.json"), "utf8")))).toEqual([
      "gold",
      "a",
      "b",
    ]);
  });
});

describe("referenceFor", () => {
  it("refuses a task that scores trees but has no truth to score them against", () => {
    const gold = { gates: [] };
    expect(() => referenceFor({ id: "x", evaluate: () => ({}) }, null, gold)).toThrow(
      /evaluate\(\) but no truth\(\)/,
    );
    expect(referenceFor({ id: "x", evaluate: () => ({}) }, task.truth(), gold)).toEqual(
      task.truth(),
    );
    expect(referenceFor({ id: "t5" }, null, gold)).toBe(gold);
    expect(() => referenceFor({ id: "t5" }, null, null)).toThrow(/no reference/);
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
    const rulings = { [d!.id]: { id: d!.id, armCorrect: true, refCorrect: false } };
    const { per, referenceErrors, contradictions } = finalScores(checksByArm, rulings);
    expect(per.passer!.correct).toBe(30);
    expect(per.failer!.correct).toBe(30);
    expect(referenceErrors).toEqual([]);
    expect(contradictions).toEqual([]);
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
