import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeAll, describe, it, expect } from "vitest";
import * as task from "../../scripts/model-bakeoff/tasks/pnpm-update.mjs";
import {
  armOutput,
  byCollection,
  extractArgs,
  prepare,
  scoreArms,
} from "../../scripts/model-bakeoff/bakeoff.mjs";
import {
  finalScores,
  groupDisagreements,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";

const { checkItems, exitCodes, lockfileFacts, observe, runChecks, snapshot, CHECKS } = task;

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
function workWith(
  lock?: string,
  exits: Record<string, string> = TRUE_EXITS,
  log = "$ vitest run\noutput\n",
) {
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

const obs = (work: string, structured: unknown) => observe(work, structured, {}, truth);

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

  it("turns the truth's failed list into one item per script", () => {
    expect(checkItems(["check"])).toEqual([
      { name: "lint", reportsOwnRun: true, noFalsePass: true, exitFailed: false },
      { name: "check", reportsOwnRun: true, noFalsePass: true, exitFailed: true },
      { name: "build", reportsOwnRun: true, noFalsePass: true, exitFailed: false },
      { name: "test:unit", reportsOwnRun: true, noFalsePass: true, exitFailed: false },
    ]);
  });

  it("reads a claimed script name loosely: case, spaces and a pnpm run prefix", () => {
    const claim = { ...REPORT, checks: { pass: false, failed: [" Check ", "pnpm run build"] } };
    const out = obs(workWith(LOCK, { check: "1", build: "1" }), claim);
    expect(out?.checks.map((c) => c.reportsOwnRun)).toEqual([true, true]);
  });
});

describe("pnpm-update exitCodes", () => {
  it("reads each script's exit code when its log is there and not empty", () => {
    expect(exitCodes(workWith(LOCK))).toEqual(TRUE_EXITS);
  });

  it("ignores a script with no log, or a log pnpm did not write", () => {
    expect(exitCodes(workWith(LOCK, { lint: "0" }))).toEqual({ lint: "0" });
    expect(exitCodes(workWith(LOCK, TRUE_EXITS, ""))).toEqual({});
    expect(exitCodes(workWith(LOCK, TRUE_EXITS, "x\n"))).toEqual({});
    const w = workWith(LOCK, {});
    writeFileSync(join(w, "logs", "check.exit"), "0\n");
    expect(exitCodes(w)).toEqual({});
  });

  it("reads a log with no exit file, or a directory for one, as a run with no exit code", () => {
    const w = workWith(LOCK, {});
    writeFileSync(join(w, "logs", "check.log"), "$ svelte-check\n");
    mkdirSync(join(w, "logs", "build.exit"));
    writeFileSync(join(w, "logs", "build.log"), "$ vite build\n");
    expect(exitCodes(w)).toEqual({ check: null, build: null });
  });

  it("reads an empty or malformed exit file as no exit code, and a padded 0 as 0", () => {
    const w = workWith(LOCK, { lint: "0", check: "1", build: "0", "test:unit": "0" });
    const exit = (name: string, text: string) =>
      writeFileSync(join(w, "logs", `${name}.exit`), text);
    exit("lint", "");
    exit("check", "0\n0\n");
    exit("build", "00\n");
    exit("test:unit", "-0\n");
    expect(exitCodes(w)).toEqual({ lint: null, check: null, build: "0", "test:unit": "0" });
    exit("lint", "1\n1\n");
    exit("check", "abc\n");
    exit("build", " 2 \n");
    exit("test:unit", "\n");
    expect(exitCodes(w)).toEqual({ lint: null, check: null, build: "2", "test:unit": null });
  });

  it("reads an exit file older than its log as a run killed before its exit code", () => {
    const w = workWith(LOCK, { lint: "0" });
    utimesSync(join(w, "logs", "lint.exit"), 1, 1);
    expect(exitCodes(w)).toEqual({ lint: null });
  });

  it("skips a directory where a log should be", () => {
    const w = workWith(LOCK, {});
    mkdirSync(join(w, "logs", "lint.log"));
    writeFileSync(join(w, "logs", "lint.exit"), "0\n");
    expect(exitCodes(w)).toEqual({});
  });

  it("finds pnpm's echo line after warnings it prints first", () => {
    const w = workWith(LOCK, { lint: "0" }, "[WARN] deprecated\nAlready up to date\n$ eslint .\n");
    expect(exitCodes(w)).toEqual({ lint: "0" });
  });

  it("ignores a log older than the lockfile, and every log when there is no lockfile", () => {
    const w = workWith(LOCK, { lint: "0" });
    utimesSync(join(w, "logs", "lint.log"), 1, 1);
    expect(exitCodes(w)).toEqual({});
    expect(exitCodes(workWith(undefined, TRUE_EXITS))).toEqual({});
  });
});

describe("pnpm-update observe", () => {
  it("scores the report's packages, the disk's lockfile, and the checks with evidence", () => {
    expect(obs(workWith(LOCK, { lint: "0", check: "1" }), REPORT)).toEqual({
      packages: DEPS,
      disk: lockfileFacts(LOCK).disk,
      checks: [
        { name: "lint", reportsOwnRun: true, noFalsePass: true, exitFailed: false },
        { name: "check", reportsOwnRun: true, noFalsePass: true, exitFailed: true },
      ],
    });
  });

  it("reads the disk from the lockfile, not from the report", () => {
    const reported = [DEPS[0], { name: "svelte", specifier: "^5.57.2", version: "5.99.0" }];
    const out = obs(workWith(LOCK), { ...REPORT, packages: reported });
    expect(out?.packages[1]?.version).toBe("5.99.0");
    expect(out?.disk).toEqual(lockfileFacts(LOCK).disk);
  });

  it("strips a peer suffix from a reported version", () => {
    const reported = [{ ...DEPS[0]!, version: "2.2.4(svelte@5.57.2)" }, DEPS[1]!];
    expect(obs(workWith(LOCK), { ...REPORT, packages: reported })?.packages).toEqual(DEPS);
  });

  it("keeps a missing reported version missing", () => {
    const out = obs(workWith(LOCK), { ...REPORT, packages: [{ name: "x", specifier: "^1" }] });
    expect(out?.packages).toEqual([{ name: "x", specifier: "^1" }]);
  });

  it("returns null for no output, and no disk item for a missing or garbled lockfile", () => {
    expect(obs(workWith(LOCK), null)).toBeNull();
    expect(obs(workWith(), REPORT)?.disk).toEqual([]);
    expect(obs(workWith("foo: [\n"), REPORT)?.disk).toEqual([]);
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
    expect(failing(scoreRun(task, truth, obs(workWith(LOCK), REPORT)))).toEqual([]);
  });

  it("fails exactly the check whose version is wrong in the truth", () => {
    const wrong = structuredClone(truth);
    wrong.packages[1]!.version = "5.57.1";
    expect(failing(scoreRun(task, wrong, obs(workWith(LOCK), REPORT)))).toEqual([
      "packages svelte / version",
    ]);
  });

  it("fails an arm that claims every check passed, and sends nothing to the referee", () => {
    const out = obs(workWith(LOCK), { ...REPORT, checks: { pass: true, failed: [] } });
    const checks = scoreRun(task, truth, out);
    expect(failing(checks)).toEqual(["checks check / reportsOwnRun", "checks check / noFalsePass"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("reads a headline pass as claiming every script passed", () => {
    const out = obs(workWith(LOCK), { ...REPORT, checks: { pass: true, failed: ["check"] } });
    expect(failing(scoreRun(task, truth, out))).toEqual([
      "checks check / reportsOwnRun",
      "checks check / noFalsePass",
    ]);
  });

  it("fails a false pass even when the arm's own run hides the failure", () => {
    const hidden = { lint: "0", check: "0", build: "0", "test:unit": "0" };
    const out = obs(workWith(LOCK, hidden), { ...REPORT, checks: { pass: true, failed: [] } });
    expect(failing(scoreRun(task, truth, out))).toEqual(["checks check / noFalsePass"]);
  });

  it("reads an exit code of 0 beside a log where pnpm reports failure as a failed run", () => {
    const w = workWith(LOCK, TRUE_EXITS);
    writeFileSync(
      join(w, "logs", "check.log"),
      "$ svelte-check\n48 ERRORS\n[ELIFECYCLE] Command failed with exit code 1.\n",
    );
    // the exit file is written after the log, as `; echo $? >` does, both after the lockfile
    const ago = (ms: number) => new Date(Date.now() - ms);
    utimesSync(join(w, "repo", "pnpm-lock.yaml"), ago(2000), ago(2000));
    utimesSync(join(w, "logs", "check.log"), ago(1000), ago(1000));
    writeFileSync(join(w, "logs", "check.exit"), "0\n");
    expect(exitCodes(w).check).toBe("log:failed");
    expect(failing(scoreRun(task, truth, obs(w, REPORT)))).toEqual([]);
  });

  it("does not read a passing test's own 'Command failed' output as pnpm's failure line", () => {
    const passing =
      "$ vitest run\nstderr | deploy.test.ts > reports a failed push\nCommand failed with exit code 1: git push\n Tests 88 passed (88)\n";
    expect(exitCodes(workWith(LOCK, { "test:unit": "0" }, passing))).toEqual({ "test:unit": "0" });
  });

  it("charges a false failure only against the arm's own run", () => {
    const out = obs(workWith(LOCK), {
      ...REPORT,
      checks: { pass: false, failed: ["check", "lint"] },
    });
    expect(failing(scoreRun(task, truth, out))).toEqual(["checks lint / reportsOwnRun"]);
  });

  it("does not charge an honest arm whose own run timed out, and records its verdict", () => {
    const out = obs(workWith(LOCK, { ...TRUE_EXITS, "test:unit": "124" }), {
      ...REPORT,
      checks: { pass: false, failed: ["check", "test:unit"] },
    });
    expect(failing(scoreRun(task, truth, out))).toEqual([]);
    expect(out?.checks.find((c) => c.name === "test:unit")?.exitFailed).toBe(true);
  });

  it("fails an arm that reports a pass for a run killed before its exit code", () => {
    const w = workWith(LOCK, { lint: "0", check: "1", build: "0" });
    writeFileSync(join(w, "logs", "test:unit.log"), "$ vitest run\n");
    const checks = scoreRun(task, truth, obs(w, REPORT));
    expect(failing(checks)).toEqual(["checks test:unit / reportsOwnRun"]);
  });

  it("fails, without a referee, verdicts on checks with no evidence on disk", () => {
    const checks = scoreRun(task, truth, obs(workWith(LOCK, { lint: "0" }), REPORT));
    expect(failing(checks)).toEqual(
      ["check", "build", "test:unit"].flatMap((n) => [
        `checks ${n} / (present)`,
        `checks ${n} / reportsOwnRun`,
        `checks ${n} / noFalsePass`,
      ]),
    );
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails the disk, not the report, for a lockfile never updated, with no referee", () => {
    const checks = scoreRun(task, truth, obs(workWith(STALE), REPORT));
    expect(failing(checks)).toEqual(["disk pnpm-lock.yaml / deps"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("fails an extra reported package, with no referee", () => {
    const extra = {
      ...REPORT,
      packages: [...DEPS, { name: "lodash", specifier: "^4", version: "4.17.21" }],
    };
    const checks = scoreRun(task, truth, obs(workWith(LOCK), extra));
    expect(failing(checks)).toEqual(["packages lodash / (extra)"]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("scores an arm with no output as no output, with nothing for the referee", () => {
    const checks = scoreRun(task, truth, obs(workWith(LOCK), null));
    expect(checks.filter((c) => c.ok)).toEqual([]);
    expect(groupDisagreements({ a: checks })).toEqual([]);
  });

  it("reports the score per collection", () => {
    const out = obs(workWith(STALE), { ...REPORT, checks: { pass: true, failed: [] } });
    const { per } = finalScores({ a: scoreRun(task, truth, out) });
    expect(byCollection(per.a!.byField)).toEqual({
      packages: "7/7",
      disk: "3/4",
      checks: "11/13",
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
        writeFileSync(join(root, id, "logs", `${name}.log`), "$ vitest run\n");
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
    // a false pass over a run whose exit hides the failure is charged on the production path
    writeFileSync(join(root, "haiku-low-1", "logs", "check.exit"), "0\n");
    const liar = {
      ...agents,
      "haiku-low-1": agent({ ...REPORT, checks: { pass: true, failed: [] } }),
    };
    const again = scoreArms(task, args, liar, truth, truth).checksByArm;
    expect(failing(again["haiku-low-1"]!)).toEqual([
      "disk pnpm-lock.yaml / deps",
      "checks check / noFalsePass",
    ]);
  });

  it("refuses a task with observe and no truth, and still reports each arm's own problems", () => {
    const arm = { id: "haiku-low-1", model: "haiku", effort: "low" };
    const args = { task: "pnpm-update", dir: "/in", work: "/w", gold: task.gold, arms: [arm] };
    const agents = { "haiku-low-1": { ...agent(REPORT), models: ["claude-sonnet-5-5"] } };
    expect(scoreArms(task, args, agents, {}, null)).toEqual({
      checksByArm: {},
      problems: [
        "pnpm-update: a task with observe() needs a truth; the gold cannot be the reference",
        "gold: no transcript found",
        "haiku-low-1: asked for claude-haiku-5-5, transcripts show claude-sonnet-5-5",
      ],
      invalid: ["haiku-low-1"],
    });
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

// snapshot() against a throwaway git repository, with a fake `pnpm` first on PATH: it answers
// --version and `store path`, and exits 1 for the subcommand named in FAKE_PNPM_FAIL.
// #1477: the log gate needs pnpm's `$ <script body>` echo, which pnpm 11.11.0 and 12.5.1 print
// and 9.15.0 and 10.18.0 do not (they print `> pkg@1.0.0 lint /path`), so every honest arm's
// check items would be absent on an older pnpm, with no warning.
describe("pnpm-update refuses a snapshot taken with pnpm older than 11", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const snap = (pnpmVersion?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "pnpm-update-version-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({ commit: "abc", ...(pnpmVersion === undefined ? {} : { pnpmVersion }) }),
    );
    return dir;
  };
  const setup = (dir: string) => () => task.setup({ input: dir, work: join(dir, "w"), ids: [] });

  it("lets pnpm 11 and 12 through", () => {
    for (const v of ["11.0.0", "11.11.0", "12.5.1"]) expect(setup(snap(v))).not.toThrow();
  });

  it("refuses pnpm 9 and 10, and a snapshot that records no version", () => {
    expect(setup(snap("10.18.0"))).toThrow(
      "pnpm-update: the snapshot ran pnpm 10.18.0, and the log gate needs pnpm 11 or later",
    );
    expect(setup(snap("9.15.0"))).toThrow(/ran pnpm 9\.15\.0/);
    expect(setup(snap())).toThrow(/records no pnpm version/);
    expect(setup(snap("next"))).toThrow(/records no pnpm version/);
  });

  it("stops prepare before the truth runs, leaving no run dir", async () => {
    const root = snap("10.18.0");
    const out = join(root, "run");
    await expect(prepare({ out, root }, task)).rejects.toThrow(/ran pnpm 10\.18\.0/);
    expect(existsSync(out)).toBe(false);
  });
});

describe("pnpm-update snapshot", () => {
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
  let base = "";
  let repo = "";
  let sha = "";
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "pnpm-update-snapshot-test-"));
    made.push(base);
    repo = join(base, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, "package.json"), "{}\n");
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "one");
    sha = git("rev-parse", "HEAD").trim();
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "pnpm"),
      [
        "#!/bin/sh",
        'if [ "$1" = "$FAKE_PNPM_FAIL" ]; then exit 1; fi',
        'case "$1" in',
        "  --version) echo 99.1.2 ;;",
        "  store) echo /fake/store ;;",
        '  update) echo meta > "$XDG_CACHE_HOME/meta.json" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "pnpm"), 0o755);
    process.env.PATH = `${bin}${delimiter}${env.PATH}`;
  });
  afterEach(() => {
    delete process.env.FAKE_PNPM_FAIL;
    if (env.TMPDIR === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = env.TMPDIR;
  });
  afterAll(() => {
    process.env.PATH = env.PATH;
  });

  it("writes the repo, the registry cache and its record, pnpm's version among them", () => {
    const out = join(base, "snap");
    expect(snapshot({ repo, commit: "HEAD", out }).commit).toBe(sha);
    expect(JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8"))).toMatchObject({
      repo,
      commit: sha,
      pnpmVersion: "99.1.2",
      store: "/fake/store",
    });
    const tar = (f: string) => execFileSync("tar", ["-tf", join(out, f)], { encoding: "utf8" });
    expect(tar("repo.tar")).toContain("package.json");
    expect(tar("registry.tar")).toContain("meta.json");
  });

  it("takes an --out relative to the working directory, not to the repo", () => {
    // A clone deeper than the working directory, so the relative --out names a different
    // place when read from the repo (from a shallow one, `..` stops at / and both agree).
    const deep = join(
      base,
      ...process
        .cwd()
        .split(sep)
        .map(() => "d"),
      "repo",
    );
    execFileSync("git", ["clone", "-q", repo, deep]);
    const out = join(base, "relative");
    const rel = relative(process.cwd(), out);
    expect(resolve(deep, rel)).not.toBe(out);
    snapshot({ repo: relative(process.cwd(), deep), commit: sha, out: rel });
    expect(existsSync(join(out, "repo.tar"))).toBe(true);
  });

  it("makes the missing parents of --out", () => {
    const out = join(base, "deep", "er", "snap");
    snapshot({ repo, commit: sha, out });
    expect(existsSync(join(out, "snapshot.json"))).toBe(true);
  });

  it("removes --out, and the parents it made, when a step fails", () => {
    process.env.FAKE_PNPM_FAIL = "install";
    expect(() => snapshot({ repo, commit: sha, out: join(base, "p", "q", "snap") })).toThrow(
      "snapshot: install failed",
    );
    expect(existsSync(join(base, "p"))).toBe(false);
    process.env.FAKE_PNPM_FAIL = "update";
    expect(() => snapshot({ repo, commit: sha, out: join(base, "flat") })).toThrow(
      "snapshot: online update failed",
    );
    expect(existsSync(join(base, "flat"))).toBe(false);
  });

  it("leaves nothing behind when its scratch directory cannot be made", () => {
    process.env.TMPDIR = join(base, "no-such-tmp");
    expect(() => snapshot({ repo, commit: sha, out: join(base, "t", "snap") })).toThrow(/ENOENT/);
    expect(existsSync(join(base, "t"))).toBe(false);
  });
});
