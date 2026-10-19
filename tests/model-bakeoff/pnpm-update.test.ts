import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import * as task from "../../scripts/model-bakeoff/tasks/pnpm-update.mjs";
import { armOutput, extractArgs } from "../../scripts/model-bakeoff/bakeoff.mjs";
import { scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";

const { lockfileFacts, observe, runChecks, CHECKS } = task;

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

function workWith(lock?: string) {
  const work = mkdtempSync(join(tmpdir(), "pnpm-update-test-"));
  mkdirSync(join(work, "repo"));
  if (lock !== undefined) writeFileSync(join(work, "repo", "pnpm-lock.yaml"), lock);
  return work;
}

const truthFrom = (pass: boolean, failed: string[]) => ({
  ...lockfileFacts(LOCK),
  checks: [{ name: "repo-checks", pass, failed }],
  report: [{ name: "report", matchesDisk: true }],
});

const failing = (checks: { ok: boolean; check: string }[]) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

describe("pnpm-update lockfileFacts", () => {
  it("reads the root importer's direct dependencies without peer suffixes, and every package key", () => {
    expect(lockfileFacts(LOCK)).toEqual({
      packages: DEPS,
      lockfile: [
        { name: "pnpm-lock.yaml", packages: ["@prismicio/svelte@2.2.4", "svelte@5.57.2"] },
      ],
    });
  });

  it("reads only the project document of a two-document pnpm 12 lockfile", () => {
    expect(lockfileFacts(LOCK).lockfile[0]?.packages).not.toContain("pnpm@12.5.1");
  });

  it("reads an empty lockfile as no packages", () => {
    expect(lockfileFacts("")).toEqual({
      packages: [],
      lockfile: [{ name: "pnpm-lock.yaml", packages: [] }],
    });
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
});

describe("pnpm-update observe", () => {
  it("scores the lockfile on disk, the claimed checks, and whether the report matches the disk", () => {
    const work = workWith(LOCK);
    const out = observe(work, { packages: DEPS, checks: { pass: false, failed: ["check"] } });
    expect(out.packages).toEqual(DEPS);
    expect(out.checks).toEqual([{ name: "repo-checks", pass: false, failed: ["check"] }]);
    expect(out.report).toEqual([{ name: "report", matchesDisk: true }]);
  });

  it("reads the packages from disk even when the report names other versions", () => {
    const work = workWith(LOCK);
    const reported = [DEPS[0], { ...DEPS[1], version: "5.99.0" }];
    const out = observe(work, { packages: reported, checks: { pass: true, failed: [] } });
    expect(out.packages).toEqual(DEPS);
    expect(out.report).toEqual([{ name: "report", matchesDisk: false }]);
  });

  it("gives an arm with no lockfile and no output nothing to score", () => {
    expect(observe(workWith(), null)).toEqual({
      packages: [],
      lockfile: [],
      checks: [],
      report: [],
    });
  });
});

describe("pnpm-update scoring", () => {
  const args = { work: "/w" };
  const arm = { id: "haiku-low-1", model: "haiku", effort: "low" };

  it("scores the truth against itself perfectly", () => {
    const t = truthFrom(false, ["check"]);
    const checks = scoreRun(task, t, t);
    expect(failing(checks)).toEqual([]);
    // 2 packages x (present + 2 fields), lockfile/checks/report present + fields, 4 well-formed
    expect(checks).toHaveLength(6 + 2 + 3 + 2 + 4);
  });

  it("fails exactly the check whose version is wrong in the truth", () => {
    const t = truthFrom(false, ["check"]);
    const wrong = structuredClone(t);
    wrong.packages[1]!.version = "5.57.1";
    expect(failing(scoreRun(task, wrong, t))).toEqual(["packages svelte / version"]);
  });

  it("fails an arm that claims the checks passed when the truth's failed", () => {
    const work = workWith(LOCK);
    const out = observe(work, { packages: DEPS, checks: { pass: true, failed: [] } });
    expect(failing(scoreRun(task, truthFrom(false, ["check"]), out))).toEqual([
      "checks repo-checks / pass",
      "checks repo-checks / failed",
    ]);
  });

  it("scores what observe reads from the arm's work dir, not the arm's report", () => {
    const seen: string[] = [];
    const observing = {
      observe: (w: string, s: unknown) => (seen.push(w), { from: "disk", s }),
    };
    expect(armOutput(observing, args, arm, { structured: { a: 1 } })).toEqual({
      from: "disk",
      s: { a: 1 },
    });
    expect(seen).toEqual(["/w/haiku-low-1"]);
    expect(armOutput({}, args, arm, { structured: { a: 1 } })).toEqual({ a: 1 });
    expect(armOutput({}, args, arm, undefined)).toBeNull();
  });

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
