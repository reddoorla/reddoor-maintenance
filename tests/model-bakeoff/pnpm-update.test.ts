import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import * as task from "../../scripts/model-bakeoff/tasks/pnpm-update.mjs";
import {
  armOutput,
  byCollection,
  extractArgs,
  scoreArms,
} from "../../scripts/model-bakeoff/bakeoff.mjs";
import {
  finalScores,
  groupDisagreements,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";

const { checkItems, exitCodes, lockfileFacts, observe, runChecks, CHECKS } = task;

const ENV_DOC = [
  "---",
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    packageManagerDependencies:",
  "      pnpm:",
  "        specifier: 12.5.1",
  "        version: 12.5.1",
  "packages:",
  "  pnpm@12.5.1:",
  "    resolution: {integrity: sha512-p}",
  "",
  "---",
];

const LOCK = [
  ...ENV_DOC,
  "lockfileVersion: '9.0'",
  "importers:",
  "  .:",
  "    dependencies:",
  "      '@prismicio/svelte':",
  "        specifier: ^2.2.4",
  "        version: 2.2.4(@prismicio/client@7.22.3)(svelte@5.57.2)",
  "    devDependencies:",
  "      svelte:",
  "        specifier: ^5.57.2",
  "        version: 5.57.2",
  "    optionalDependencies:",
  "      fsevents:",
  "        specifier: ^2.3.3",
  "        version: 2.3.3",
  "packages:",
  "  '@prismicio/svelte@2.2.4':",
  "    resolution: {integrity: sha512-a}",
  "  svelte@5.57.2:",
  "    resolution: {integrity: sha512-b}",
  "",
].join("\n");

const DEPS = [
  { name: "@prismicio/svelte", specifier: "^2.2.4", version: "2.2.4" },
  { name: "svelte", specifier: "^5.57.2", version: "5.57.2" },
];

const STALE = LOCK.replace("version: 5.57.2", "version: 5.55.10");
const TRUE_EXITS = { lint: "0", check: "1", build: "0", "test:unit": "0" };

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// A work dir holding a lockfile and, for each script given, the log and exit file the prompt
// tells the arm to write.
function workWith(lock?: string, exits: Record<string, string> = TRUE_EXITS, log = "output\n") {
  const work = mkdtempSync(join(tmpdir(), "pnpm-update-test-"));
  made.push(work);
  mkdirSync(join(work, "repo"));
  mkdirSync(join(work, "logs"));
  if (lock !== undefined) writeFileSync(join(work, "repo", "pnpm-lock.yaml"), lock);
  for (const [name, code] of Object.entries(exits)) {
    writeFileSync(join(work, "logs", `${name}.log`), log);
    writeFileSync(join(work, "logs", `${name}.exit`), `${code}\n`);
  }
  return work;
}

const truth = { ...lockfileFacts(LOCK), checks: checkItems(["check"]) };
const REPORT = { packages: DEPS, checks: { pass: false, failed: ["check"] } };

const failing = (checks: { ok: boolean; check: string }[]) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

describe("pnpm-update lockfileFacts", () => {
  it("reads the project's direct dependencies without peer suffixes, and every package key", () => {
    expect(lockfileFacts(LOCK)).toEqual({
      packages: DEPS,
      disk: [
        {
          name: "pnpm-lock.yaml",
          deps: ["@prismicio/svelte ^2.2.4 2.2.4", "svelte ^5.57.2 5.57.2"],
          packages: ["@prismicio/svelte@2.2.4", "svelte@5.57.2"],
        },
      ],
    });
  });

  it("reads only the project document of a two-document pnpm 12 lockfile", () => {
    expect(lockfileFacts(LOCK).disk[0]?.packages).not.toContain("pnpm@12.5.1");
  });

  it("ignores a trailing empty document", () => {
    expect(lockfileFacts(`${LOCK}---\n`).packages).toEqual(DEPS);
  });

  it("reads an empty lockfile as no packages", () => {
    expect(lockfileFacts("").packages).toEqual([]);
  });
});

describe("pnpm-update runChecks and checkItems", () => {
  it("passes only when every check exits 0", () => {
    expect(runChecks(() => 0)).toEqual({ pass: true, failed: [] });
  });

  it("counts a failing check as a failure and still runs the ones after it", () => {
    const ran: string[] = [];
    const result = runChecks((args) => {
      ran.push(String(args[1]));
      return args[1] === "check" ? 1 : 0;
    });
    expect(result).toEqual({ pass: false, failed: ["check"] });
    expect(ran).toEqual(CHECKS);
  });

  it("turns a failed list into one item per script", () => {
    expect(checkItems(["check"])).toEqual([
      { name: "lint", failed: false, exitFailed: false },
      { name: "check", failed: true, exitFailed: true },
      { name: "build", failed: false, exitFailed: false },
      { name: "test:unit", failed: false, exitFailed: false },
    ]);
  });

  it("reads a claimed script name loosely: case, spaces and a pnpm run prefix", () => {
    expect(checkItems([" Check ", "pnpm run build"]).filter((c) => c.failed)).toEqual([
      { name: "check", failed: true, exitFailed: true },
      { name: "build", failed: true, exitFailed: true },
    ]);
  });
});

describe("pnpm-update exitCodes", () => {
  it("reads each script's exit code when its log is there and not empty", () => {
    expect(exitCodes(workWith(LOCK))).toEqual(TRUE_EXITS);
  });

  it("ignores a script with no log, an empty log, or no exit file", () => {
    expect(exitCodes(workWith(LOCK, { lint: "0" }))).toEqual({ lint: "0" });
    expect(exitCodes(workWith(LOCK, TRUE_EXITS, ""))).toEqual({});
    const w = workWith(LOCK, {});
    writeFileSync(join(w, "logs", "check.log"), "output\n");
    expect(exitCodes(w)).toEqual({});
  });
});

describe("pnpm-update observe", () => {
  it("scores the report's packages, the disk's lockfile, and the checks with evidence", () => {
    expect(observe(workWith(LOCK, { lint: "0", check: "1" }), REPORT)).toEqual({
      packages: DEPS,
      disk: lockfileFacts(LOCK).disk,
      checks: [
        { name: "lint", failed: false, exitFailed: false },
        { name: "check", failed: true, exitFailed: true },
      ],
    });
  });

  it("reads the disk from the lockfile, not from the report", () => {
    const reported = [DEPS[0], { name: "svelte", specifier: "^5.57.2", version: "5.99.0" }];
    const out = observe(workWith(LOCK), { ...REPORT, packages: reported });
    expect(out?.packages[1]?.version).toBe("5.99.0");
    expect(out?.disk).toEqual(lockfileFacts(LOCK).disk);
  });

  it("keeps a missing reported version missing", () => {
    const out = observe(workWith(LOCK), { ...REPORT, packages: [{ name: "x", specifier: "^1" }] });
    expect(out?.packages).toEqual([{ name: "x", specifier: "^1" }]);
  });

  it("returns null for no output, and no disk item for a missing or garbled lockfile", () => {
    expect(observe(workWith(LOCK), null)).toBeNull();
    expect(observe(workWith(), REPORT)?.disk).toEqual([]);
    expect(observe(workWith("foo: [\n"), REPORT)?.disk).toEqual([]);
  });
});

describe("pnpm-update scoring", () => {
  it("scores the truth against itself perfectly", () => {
    const checks = scoreRun(task, truth, truth);
    expect(failing(checks)).toEqual([]);
    // packages 2 x 3, disk 1 x 3, checks 4 x 3, and 3 well-formed
    expect(checks).toHaveLength(6 + 3 + 12 + 3);
  });

  it("scores an honest arm perfectly", () => {
    expect(failing(scoreRun(task, truth, observe(workWith(LOCK), REPORT)))).toEqual([]);
  });

  it("fails exactly the check whose version is wrong in the truth", () => {
    const wrong = structuredClone(truth);
    wrong.packages[1]!.version = "5.57.1";
    expect(failing(scoreRun(task, wrong, observe(workWith(LOCK), REPORT)))).toEqual([
      "packages svelte / version",
    ]);
  });

  it("fails an arm that claims every check passed, and sends nothing to the referee", () => {
    const out = observe(workWith(LOCK), { ...REPORT, checks: { pass: true, failed: [] } });
    const checks = scoreRun(task, truth, out);
    expect(failing(checks)).toEqual(["checks check / failed"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails both verdicts when the arm's own run disagrees with the truth", () => {
    const out = observe(workWith(LOCK, { ...TRUE_EXITS, "test:unit": "124" }), {
      ...REPORT,
      checks: { pass: false, failed: ["check", "test:unit"] },
    });
    expect(failing(scoreRun(task, truth, out))).toEqual([
      "checks test:unit / failed",
      "checks test:unit / exitFailed",
    ]);
  });

  it("fails, without a referee, verdicts on checks with no evidence on disk", () => {
    const checks = scoreRun(task, truth, observe(workWith(LOCK, { lint: "0" }), REPORT));
    expect(failing(checks)).toEqual(
      ["check", "build", "test:unit"].flatMap((n) => [
        `checks ${n} / (present)`,
        `checks ${n} / failed`,
        `checks ${n} / exitFailed`,
      ]),
    );
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails the disk, not the report, for a lockfile never updated, with no referee", () => {
    const checks = scoreRun(task, truth, observe(workWith(STALE), REPORT));
    expect(failing(checks)).toEqual(["disk pnpm-lock.yaml / deps"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails an extra reported package, with no referee", () => {
    const extra = {
      ...REPORT,
      packages: [...DEPS, { name: "lodash", specifier: "^4", version: "4.17.21" }],
    };
    const checks = scoreRun(task, truth, observe(workWith(LOCK), extra));
    expect(failing(checks)).toEqual(["packages lodash / (extra)"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("scores an arm with no output as no output, with nothing for the referee", () => {
    const checks = scoreRun(task, truth, observe(workWith(LOCK), null));
    expect(checks.filter((c) => c.ok)).toEqual([]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("reports the score per collection", () => {
    const out = observe(workWith(STALE), { ...REPORT, checks: { pass: true, failed: [] } });
    const { per } = finalScores({ a: scoreRun(task, truth, out) });
    expect(byCollection(per.a!.byField)).toEqual({
      packages: "7/7",
      disk: "3/4",
      checks: "12/13",
    });
  });
});

describe("pnpm-update through scoreArms", () => {
  const agent = (structured: unknown) => ({
    transcript: "t",
    marker: null,
    markerError: null,
    structured,
    models: ["claude-haiku-5-5"],
    efforts: ["low"],
    requests: 1,
    repeats: 0,
    cost: 0,
    longPrompt: 0,
    bash: [],
    writes: [],
    otherTools: [],
    prompt: "",
    forbidden: [],
  });

  it("scores what observe reads from each arm's work dir", () => {
    const root = mkdtempSync(join(tmpdir(), "pnpm-update-test-"));
    made.push(root);
    for (const [id, lock] of [
      ["gold", LOCK],
      ["haiku-low-1", STALE],
    ] as const) {
      mkdirSync(join(root, id, "repo"), { recursive: true });
      mkdirSync(join(root, id, "logs"));
      writeFileSync(join(root, id, "repo", "pnpm-lock.yaml"), lock);
      for (const [name, code] of Object.entries(TRUE_EXITS)) {
        writeFileSync(join(root, id, "logs", `${name}.log`), "output\n");
        writeFileSync(join(root, id, "logs", `${name}.exit`), `${code}\n`);
      }
    }
    const args = {
      task: "pnpm-update",
      dir: "/in",
      work: root,
      gold: { id: "gold", model: "haiku", effort: "low" },
      arms: [{ id: "haiku-low-1", model: "haiku", effort: "low" }],
    };
    const agents = { gold: agent(REPORT), "haiku-low-1": agent(REPORT) };
    const { checksByArm, problems } = scoreArms(task, args, agents, truth, truth);
    expect(problems).toEqual([]);
    expect(failing(checksByArm.gold!)).toEqual([]);
    expect(failing(checksByArm["haiku-low-1"]!)).toEqual(["disk pnpm-lock.yaml / deps"]);
  });

  it("refuses a task with observe and no truth", () => {
    const args = { task: "pnpm-update", dir: "/in", work: "/w", gold: task.gold, arms: task.arms };
    expect(scoreArms(task, args, {}, {}, null).problems).toEqual([
      "pnpm-update: a task with observe() needs a truth; the gold cannot be the reference",
    ]);
  });

  it("leaves a task without observe on its structured output", () => {
    const arm = { id: "haiku-low-1", model: "haiku", effort: "low" };
    expect(armOutput({}, { work: "/w" }, arm, { structured: { a: 1 } })).toEqual({ a: 1 });
    expect(armOutput({}, { work: "/w" }, arm, undefined)).toBeNull();
    expect(armOutput(task, { work: "/nonexistent" }, arm, { structured: null })).toBeNull();
  });
});

describe("pnpm-update arms and prompt", () => {
  it("refuses an arm with no effort", () => {
    const arms = [...task.arms, { id: "haiku-x", model: "haiku" }];
    expect(() => extractArgs(task, "/in", arms as typeof task.arms)).toThrow(/has no effort/);
  });

  it("tells every arm the exact offline update command and where to leave each check's evidence", () => {
    const p = task.prompt("/run/input");
    expect(p).toContain("XDG_CACHE_HOME=<work>/cache pnpm update --offline`");
    expect(p).toContain("`pnpm run S > <work>/logs/S.log 2>&1; echo $? > <work>/logs/S.exit`");
    for (const c of CHECKS) expect(p).toContain(c);
    for (const a of task.arms) expect(a.effort).toBeTruthy();
  });
});
