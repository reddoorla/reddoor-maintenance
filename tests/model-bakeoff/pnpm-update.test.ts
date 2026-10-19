import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import * as task from "../../scripts/model-bakeoff/tasks/pnpm-update.mjs";
import { armOutput, extractArgs, scoreArms } from "../../scripts/model-bakeoff/bakeoff.mjs";
import { groupDisagreements, scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";

const { checkItems, lockfileFacts, observe, ranScript, runChecks, CHECKS } = task;

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
const RAN_ALL = CHECKS.map((c) => `cd /w/repo && pnpm run ${c} 2>&1 | tail -5`);

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function workWith(lock?: string) {
  const work = mkdtempSync(join(tmpdir(), "pnpm-update-test-"));
  made.push(work);
  mkdirSync(join(work, "repo"));
  if (lock !== undefined) writeFileSync(join(work, "repo", "pnpm-lock.yaml"), lock);
  return work;
}

const truth = { ...lockfileFacts(LOCK), checks: checkItems(["check"]) };

const failing = (checks: { ok: boolean; check: string }[]) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

const honest = (work: string) =>
  observe(work, { packages: DEPS, checks: { pass: false, failed: ["check"] } }, { bash: RAN_ALL });

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

describe("pnpm-update runChecks", () => {
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
      { name: "lint", failed: false },
      { name: "check", failed: true },
      { name: "build", failed: false },
      { name: "test:unit", failed: false },
    ]);
  });
});

describe("pnpm-update ranScript", () => {
  it("finds a script run with or without `run`, inside a longer command", () => {
    expect(ranScript(["cd r && pnpm run check 2>&1 | tail"], "check")).toBe(true);
    expect(ranScript(["XDG_CACHE_HOME=c pnpm check; echo $?"], "check")).toBe(true);
    expect(ranScript(["pnpm run test:unit"], "test:unit")).toBe(true);
  });

  it("expands a for loop over the script names, the form the arms used", () => {
    const loop =
      "cd $W/repo && export XDG_CACHE_HOME=$W/cache; for s in lint check build test:unit; do pnpm run $s > $W/run-$(echo $s | tr ':' '_').log 2>&1; echo \"$s EXIT $?\"; done";
    for (const c of CHECKS) expect(ranScript([loop], c)).toBe(true);
    expect(ranScript(['for s in lint check\ndo timeout 900 pnpm run "${s}"; done'], "check")).toBe(
      true,
    );
  });

  it("does not credit a loop that leaves the script out or never runs pnpm with it", () => {
    expect(ranScript(["for s in lint build; do pnpm run $s; done"], "check")).toBe(false);
    expect(ranScript(["for s in lint check; do echo $s; done"], "check")).toBe(false);
    expect(ranScript(["for s in lint check; do pnpm run lint; done"], "check")).toBe(false);
  });

  it("does not take one script for another", () => {
    expect(ranScript(["pnpm run check:watch"], "check")).toBe(false);
    expect(ranScript(["pnpm run lint"], "check")).toBe(false);
    expect(ranScript(["echo pnpm-run-check"], "check")).toBe(false);
  });
});

describe("pnpm-update observe", () => {
  it("scores the report's packages, the disk's lockfile, and only the checks the arm ran", () => {
    const out = observe(
      workWith(LOCK),
      { packages: DEPS, checks: { pass: false, failed: ["check"] } },
      { bash: ["pnpm run lint", "pnpm run check"] },
    );
    expect(out).toEqual({
      packages: DEPS,
      disk: lockfileFacts(LOCK).disk,
      checks: [
        { name: "lint", failed: false },
        { name: "check", failed: true },
      ],
    });
  });

  it("reads the disk from the lockfile, not from the report", () => {
    const reported = [DEPS[0], { name: "svelte", specifier: "^5.57.2", version: "5.99.0" }];
    const out = observe(
      workWith(LOCK),
      { packages: reported, checks: { pass: true, failed: [] } },
      {},
    );
    expect(out?.packages[1]?.version).toBe("5.99.0");
    expect(out?.disk).toEqual(lockfileFacts(LOCK).disk);
  });

  it("returns null for no output, and no disk item for a missing or garbled lockfile", () => {
    expect(observe(workWith(LOCK), null, {})).toBeNull();
    const s = { packages: DEPS, checks: { pass: true, failed: [] } };
    expect(observe(workWith(), s, {})?.disk).toEqual([]);
    expect(observe(workWith("foo: [\n"), s, {})?.disk).toEqual([]);
  });
});

describe("pnpm-update scoring", () => {
  it("scores the truth against itself perfectly", () => {
    const checks = scoreRun(task, truth, truth);
    expect(failing(checks)).toEqual([]);
    // packages 2 x 3, disk 1 x 3, checks 4 x 2, and 3 well-formed
    expect(checks).toHaveLength(6 + 3 + 8 + 3);
  });

  it("fails exactly the check whose version is wrong in the truth", () => {
    const wrong = structuredClone(truth);
    wrong.packages[1]!.version = "5.57.1";
    expect(failing(scoreRun(task, wrong, honest(workWith(LOCK))))).toEqual([
      "packages svelte / version",
    ]);
  });

  it("fails an arm that claims every check passed", () => {
    const out = observe(
      workWith(LOCK),
      { packages: DEPS, checks: { pass: true, failed: [] } },
      { bash: RAN_ALL },
    );
    expect(failing(scoreRun(task, truth, out))).toEqual(["checks check / failed"]);
  });

  it("fails, without a referee, verdicts on checks the arm never ran", () => {
    const out = observe(
      workWith(LOCK),
      { packages: DEPS, checks: { pass: false, failed: ["check"] } },
      { bash: ["pnpm run lint"] },
    );
    const checks = scoreRun(task, truth, out);
    expect(failing(checks)).toEqual([
      "checks check / (present)",
      "checks check / failed",
      "checks build / (present)",
      "checks build / failed",
      "checks test:unit / (present)",
      "checks test:unit / failed",
    ]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails the disk, not the report, for an arm whose lockfile was never updated", () => {
    expect(failing(scoreRun(task, truth, honest(workWith(STALE))))).toEqual([
      "disk pnpm-lock.yaml / deps",
    ]);
  });

  it("scores an arm with no output as no output, with nothing for the referee", () => {
    const checks = scoreRun(task, truth, observe(workWith(LOCK), null, {}));
    expect(checks.filter((c) => c.ok)).toEqual([]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });
});

describe("pnpm-update through scoreArms", () => {
  const agent = (structured: unknown, bash: string[]) => ({
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
    bash,
    writes: [],
    otherTools: [],
    prompt: "",
    forbidden: [],
  });

  it("scores what observe reads from each arm's work dir and transcript", () => {
    const root = mkdtempSync(join(tmpdir(), "pnpm-update-test-"));
    made.push(root);
    for (const [id, lock] of [
      ["gold", LOCK],
      ["haiku-low-1", STALE],
    ] as const) {
      mkdirSync(join(root, id, "repo"), { recursive: true });
      writeFileSync(join(root, id, "repo", "pnpm-lock.yaml"), lock);
    }
    const args = {
      task: "pnpm-update",
      dir: "/in",
      work: root,
      gold: { id: "gold", model: "haiku", effort: "low" },
      arms: [{ id: "haiku-low-1", model: "haiku", effort: "low" }],
    };
    const s = { packages: DEPS, checks: { pass: false, failed: ["check"] } };
    const agents = { gold: agent(s, RAN_ALL), "haiku-low-1": agent(s, RAN_ALL) };
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
  });
});

describe("pnpm-update arms", () => {
  it("refuses an arm with no effort", () => {
    const arms = [...task.arms, { id: "haiku-x", model: "haiku" }];
    expect(() => extractArgs(task, "/in", arms as typeof task.arms)).toThrow(/has no effort/);
  });

  it("tells every arm the exact offline update command and every check", () => {
    const p = task.prompt("/run/input");
    expect(p).toContain("XDG_CACHE_HOME=<work>/cache pnpm update --offline`");
    for (const c of CHECKS) expect(p).toContain(`pnpm run ${c}`);
    for (const a of task.arms) expect(a.effort).toBeTruthy();
  });
});
