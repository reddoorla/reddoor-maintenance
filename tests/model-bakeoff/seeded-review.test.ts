import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { groupDisagreements, disagreementId } from "../../scripts/model-bakeoff/lib/score.mjs";
import { scorerFor } from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";
import * as review from "../../scripts/model-bakeoff/tasks/seeded-review.mjs";
import {
  buildCases,
  cleanDiff,
  gitAttrSourceWorks,
  haveHistory,
} from "../../scripts/model-bakeoff/tasks/seeded-review/build.mjs";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Check,
  Finding,
  Reference,
  RunSummary,
} from "../../scripts/model-bakeoff/tasks/seeded-review.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CASES = fileURLToPath(
  new URL("../../scripts/model-bakeoff/tasks/seeded-review", import.meta.url),
);

const REF: Reference = {
  defects: [
    {
      id: "d-crit",
      case: "r01",
      file: "src/a.ts",
      ranges: [[10, 12]],
      critical: true,
      description: "x",
    },
    {
      id: "d-plain",
      case: "r03",
      file: "src/b.ts",
      ranges: [
        [40, 40],
        [90, 91],
      ],
      critical: false,
      description: "y",
    },
  ],
  controls: [{ case: "r02", file: "src/a.ts" }],
};

const f = (c: string, file: string, a: number, b = a, summary = "bug"): Finding => ({
  case: c,
  file,
  startLine: a,
  endLine: b,
  severity: "major",
  summary,
});

/** Every referee item ruled the same way: ARM right (or wrong), the reference right. */
const ruleAll = (checks: Check[], armCorrect = true) =>
  Object.fromEntries(
    groupDisagreements({ arm: checks }).map((g) => [
      g.id,
      { id: g.id, armCorrect, refCorrect: true },
    ]),
  );

const summary = (findings: Finding[], rule?: boolean) => {
  const out = { findings, unverified: [] };
  const checks = review.scoreRun(null, REF, out);
  return review.runSummary(REF, checks, rule === undefined ? {} : ruleAll(checks, rule), out);
};

describe("seeded-review key", () => {
  it("fits the frozen cases: every file exists and every anchor sits in its range", () => {
    const t = review.truth(CASES);
    expect(t.defects).toHaveLength(7);
    expect(t.excluded!.map((e) => e.id)).toEqual(["d2-period-overlap", "d9-approved-no-refresh"]);
    expect(t.cases).toHaveLength(11);
    expect(t.defects.filter((d) => d.critical).map((d) => d.id)).toEqual([
      "d5-clone-argv-injection",
      "d6-clone-path-traversal",
      "d7-uid-lookup-collision",
    ]);
    expect(t.controls.map((c) => c.case)).toEqual(["r02", "r06", "r10"]);
  });

  const expectCommitted = (dir: string) => {
    const committed = join(CASES, "cases");
    expect(readdirSync(dir).sort()).toEqual(readdirSync(committed).sort());
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name)).equals(readFileSync(join(committed, name))), name).toBe(
        true,
      );
    }
  };

  it.skipIf(!haveHistory())("matches what build.mjs rebuilds from git, byte for byte", () => {
    const dir = mkdtempSync(join(tmpdir(), "seeded-review-"));
    try {
      buildCases(dir);
      expectCommitted(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!haveHistory())(
    "rebuilds the same bytes in a checkout whose attributes would change the diff",
    () => {
      const root = mkdtempSync(join(tmpdir(), "seeded-review-attrs-"));
      try {
        const clone = join(root, "r");
        execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", REPO_ROOT, clone]);
        // Each of these alone turns every case's diff into "Binary files differ". A
        // checkout's own .gitattributes can only be ignored where git honours
        // GIT_ATTR_SOURCE (2.40 and later; stock macOS ships 2.39), so it is tried only there.
        if (gitAttrSourceWorks()) writeFileSync(join(clone, ".gitattributes"), "*.ts -diff\n");
        writeFileSync(join(root, "attrs"), "*.ts -diff\n");
        execFileSync("git", ["-C", clone, "config", "core.attributesFile", join(root, "attrs")]);
        const out = join(root, "out");
        mkdirSync(out);
        buildCases(out, undefined, clone);
        expectCommitted(out);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!haveHistory())("ignores a GIT_DIR inherited from a git hook", () => {
    const empty = mkdtempSync(join(tmpdir(), "seeded-review-gitdir-"));
    try {
      execFileSync("git", ["init", "-q", empty]);
      const r = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { haveHistory } from ${JSON.stringify(pathToFileURL(join(CASES, "build.mjs")).href)};
           process.exit(haveHistory() ? 0 : 3);`,
        ],
        {
          env: {
            ...process.env,
            GIT_DIR: join(empty, ".git"),
            GIT_WORK_TREE: empty,
            GIT_INDEX_FILE: join(empty, ".git", "index"),
          },
          encoding: "utf8",
        },
      );
      expect(r.status, r.stderr).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("drops index lines so a diff names no blob to look up", () => {
    expect(cleanDiff("diff --git a/x b/x\nindex 1a2b..3c4d 100644\n--- a/x\n+b")).toBe(
      "diff --git a/x b/x\n--- a/x\n+b",
    );
  });
});

describe("matching a finding to a seeded defect", () => {
  it("makes a candidate of the right case and file when the ranges overlap, by path suffix too", () => {
    expect(review.relation(f("r01", "src/a.ts", 12, 15), REF.defects[0]!)).toBe("overlap");
    expect(review.relation(f("R01", "b/src/a.ts", 9, 10), REF.defects[0]!)).toBe("overlap");
    expect(review.relation(f("r01", "a.ts", 11), REF.defects[0]!)).toBe("overlap");
    expect(review.relation(f("r03", "src/b.ts", 91), REF.defects[1]!)).toBe("overlap");
  });

  it("never matches a finding in the wrong file, even on the same lines", () => {
    expect(review.relation(f("r01", "src/other.ts", 10, 12), REF.defects[0]!)).toBeNull();
    expect(review.relation(f("r01", "lib/src/a.ts.bak", 10, 12), REF.defects[0]!)).toBeNull();
    expect(summary([f("r01", "src/other.ts", 10, 12)], true).found).toBe(0);
  });

  it("never matches a finding in the wrong case", () => {
    expect(review.relation(f("r03", "src/a.ts", 10, 12), REF.defects[0]!)).toBeNull();
  });

  it("makes a candidate of a finding up to NEAR_LINES away, and of nothing farther", () => {
    expect(review.relation(f("r01", "src/a.ts", 22), REF.defects[0]!)).toBe("near");
    expect(review.relation(f("r01", "src/a.ts", 23), REF.defects[0]!)).toBeNull();
    expect(review.relation({ case: "r01", file: "src/a.ts" }, REF.defects[0]!)).toBeNull();
  });
});

describe("scoring one run", () => {
  it("scores the key against itself as perfect once the referee confirms each candidate", () => {
    const self = REF.defects.map((d) => f(d.case, d.file, d.ranges[0]![0], d.ranges[0]![1]));
    expect(summary(self)).toMatchObject({ found: 0, unruled: 2 });
    expect(summary(self, true)).toMatchObject({
      found: 2,
      of: 2,
      criticalFound: 1,
      criticalMissed: [],
      falsePositives: 0,
      otherFindings: 0,
    });
  });

  it("fails exactly where the key was perturbed", () => {
    const self = REF.defects.map((d) => f(d.case, d.file, d.ranges[0]![0], d.ranges[0]![1]));
    self[0] = f("r01", "src/elsewhere.ts", 10, 12);
    expect(summary(self, true)).toMatchObject({
      found: 1,
      missed: ["d-crit"],
      criticalMissed: ["d-crit"],
    });
  });

  it("counts a finding on a clean control as a false positive, never as a hit", () => {
    const s = summary([f("r02", "src/a.ts", 10, 12)], false);
    expect(s.found).toBe(0);
    expect(s.criticalMissed).toEqual(["d-crit"]);
    expect(s.falsePositives).toBe(1);
  });

  it("credits a near miss and clears a control finding only on the referee's word", () => {
    const out = { findings: [f("r01", "src/a.ts", 18), f("r02", "src/a.ts", 5)], unverified: [] };
    const checks = review.scoreRun(null, REF, out);
    const groups = groupDisagreements({ arm: checks });
    expect(groups.map((g) => g.check)).toEqual([
      "defects d-crit / found",
      expect.stringMatching(/^controls r02 \/ finding src\/a\.ts:5-5 #[0-9a-f]{8}$/),
    ]);
    expect(review.runSummary(REF, checks, {}, out)).toMatchObject({
      found: 0,
      falsePositives: 1,
      unruled: 2,
    });
    const yes = Object.fromEntries(
      checks
        .filter((c) => !c.ok && !c.mechanical && c.armRaw !== "<missing>")
        .map((c) => [
          disagreementId(c),
          { id: disagreementId(c), armCorrect: true, refCorrect: true },
        ]),
    );
    expect(review.runSummary(REF, checks, yes, out)).toMatchObject({
      found: 1,
      falsePositives: 0,
      realOnControls: 1,
      unruled: 0,
    });
  });

  it("credits no overlapping finding the referee rules a different defect", () => {
    expect(
      summary([f("r01", "src/a.ts", 11, 11, "an unrelated rounding slip")], false),
    ).toMatchObject({
      found: 0,
      unruled: 0,
    });
  });

  it("counts a finding the referee ruled a different defect among the other findings", () => {
    const rounding = [f("r01", "src/a.ts", 11, 11, "an unrelated rounding slip")];
    expect(summary(rounding, false).otherFindings).toBe(1);
    expect(summary(rounding, true).otherFindings).toBe(0);
    expect(summary(rounding).otherFindings).toBe(0);
  });

  it("names a seeded defect the referee refuted", () => {
    const out = { findings: [f("r03", "src/b.ts", 40)], unverified: [] };
    const checks = review.scoreRun(null, REF, out);
    const [g] = groupDisagreements({ arm: checks });
    const rulings = { [g!.id]: { id: g!.id, armCorrect: false, refCorrect: false } };
    expect(review.runSummary(REF, checks, rulings, out).disputedDefects).toEqual(["d-plain"]);
  });

  it("counts other findings on a seeded case whose defect the key excludes", () => {
    const ref = { ...REF, cases: ["r01", "r02", "r03", "r11"] };
    const out = { findings: [f("r11", "src/c.ts", 5)], unverified: [] };
    expect(review.runSummary(ref, review.scoreRun(null, ref, out), {}, out).otherFindings).toBe(1);
  });

  it("counts a finding listed twice on a control as one false positive, however reworded", () => {
    const twice = f("r02", "src/a.ts", 5);
    expect(summary([twice, { ...twice }], false).falsePositives).toBe(1);
    expect(
      summary([twice, { ...twice, summary: "bug.", severity: "minor" }], false).falsePositives,
    ).toBe(1);
  });

  // #1462: control r02's one finding, restated as src/alerts/waiting.ts:10-12, r02.after.waiting.ts,
  // ./waiting.ts and :10-13, made 3 control checks where 1 is meant.
  it("counts one control finding as one false positive, whatever path form or overlapping range restates it", () => {
    const restated = [
      f("r02", "src/a.ts", 10, 12),
      f("r02", "r02.after.a.ts", 10, 12, "the same bug"),
      f("r02", "./a.ts", 10, 12),
      f("r02", "src/a.ts", 10, 13),
    ];
    const controls = (fs: Finding[]) =>
      review
        .scoreRun(null, REF, { findings: fs, unverified: [] })
        .filter((c) => c.collection === "controls");
    const [one, ...rest] = controls([...restated, { ...restated[0]! }]);
    expect(rest).toEqual([]);
    expect(one!.check).toMatch(/^controls r02 \/ finding src\/a\.ts:10-13 #[0-9a-f]{8}$/);
    // The referee sees each wording once, and the same findings in another order make the same check.
    expect(one!.armRaw.split(" || ")).toHaveLength(restated.length);
    expect(controls([...restated].reverse())[0]).toEqual(one);
    expect(summary(restated, false).falsePositives).toBe(1);
    // Another file, or lines that do not overlap, stay findings of their own.
    const apart = [...restated, f("r02", "src/a.ts", 14, 16), f("r02", "src/other.ts", 10, 12)];
    expect(summary(apart, false).falsePositives).toBe(3);
  });

  it("merges only findings that all share a line, so a chain or a wide range swallows nothing", () => {
    const chain = [1, 3, 5, 7].map((a) => f("r02", "src/a.ts", a, a + 2, `bug ${a}`));
    // 1-3 and 3-5 share line 3, 5-7 and 7-9 share line 7; 1-3 and 5-7 share none.
    expect(summary(chain, false).falsePositives).toBe(2);
    const wide = [
      f("r02", "src/a.ts", 1, 200, "the whole file"),
      ...[10, 50, 150].map((a) => f("r02", "src/a.ts", a)),
    ];
    // The wide range meets each point, but the points never meet one another.
    expect(summary(wide, false).falsePositives).toBe(3);
  });

  // Operator decisions 137 (k), answered (b): r07's d5 (43-46) and d6 (34-35) sit 8 lines apart, so
  // one finding can be a candidate for both. It still counts for both, but each referee item
  // names the other defect, so a lenient referee is told what it is ruling on (#1465 a).
  describe("a finding near two seeded defects", () => {
    const two: Reference = {
      defects: [
        {
          id: "d6",
          case: "r07",
          file: "src/c.ts",
          ranges: [[34, 35]],
          critical: true,
          description: "path traversal",
        },
        {
          id: "d5",
          case: "r07",
          file: "src/c.ts",
          ranges: [[43, 46]],
          critical: true,
          description: "argv injection",
        },
      ],
      controls: [],
    };
    const check = (findings: Finding[], id: string) =>
      review.scoreRun(null, two, { findings, unverified: [] }).find((c) => c.key === id)!;

    it("names the other defect in each referee item, and credits only what it identifies", () => {
      const both = [f("r07", "src/c.ts", 42, 44, "no -- before repoUrl, and name is unchecked")];
      expect(check(both, "d5").refRaw).toContain(
        "One of these findings is also near d6 at r07 src/c.ts:34-35 (path traversal): credit it here only if it identifies THIS defect, not only that one. A finding that identifies both counts for both.",
      );
      expect(check(both, "d6").refRaw).toContain(
        "also near d5 at r07 src/c.ts:43-46 (argv injection)",
      );
    });

    it("says nothing extra when no candidate is near another defect", () => {
      // 50-52 is 4 lines from d5 and 15 from d6, past NEAR_LINES.
      expect(check([f("r07", "src/c.ts", 50, 52)], "d5").refRaw).not.toContain("also near");
    });

    it("still counts one finding for both defects when the referee rules it identifies each", () => {
      const out = { findings: [f("r07", "src/c.ts", 34, 46, "both bugs")], unverified: [] };
      const checks = review.scoreRun(null, two, out);
      expect(review.runSummary(two, checks, ruleAll(checks, true), out)).toMatchObject({
        found: 2,
        criticalMissed: [],
      });
    });
  });

  it("refutes nothing when the rulings on a defect split, and gives no verdict", () => {
    const out = { findings: [f("r01", "src/a.ts", 11)], unverified: [] };
    const other = { findings: [f("r01", "src/a.ts", 12)], unverified: [] };
    const checksByArm = {
      "opus-xhigh-1": review.scoreRun(null, REF, out),
      "opus-xhigh-2": review.scoreRun(null, REF, out),
      "x-1": review.scoreRun(null, REF, other),
      "x-2": review.scoreRun(null, REF, other),
    };
    const [a] = groupDisagreements({ a: checksByArm["opus-xhigh-1"] });
    const [b] = groupDisagreements({ b: checksByArm["x-1"] });
    const rulings = {
      [a!.id]: { id: a!.id, armCorrect: true, refCorrect: true },
      [b!.id]: { id: b!.id, armCorrect: false, refCorrect: false },
    };
    const s = review.summarize({
      reference: REF,
      checksByArm,
      rulings,
      outputs: { "opus-xhigh-1": out, "opus-xhigh-2": out, "x-1": other, "x-2": other },
    });
    expect(s.refutedDefects).toEqual([]);
    expect(s.splitDefects).toEqual(["d-crit"]);
    expect(s.groups["x"]!.verdict).toMatch(/^pending/);
  });

  it("gives no verdict when a run returned no output", () => {
    const out = { findings: [], unverified: [] };
    const s = review.summarize({
      reference: REF,
      checksByArm: {
        "opus-xhigh-1": review.scoreRun(null, REF, out),
        "opus-xhigh-2": review.scoreRun(null, REF, out),
        "x-1": review.scoreRun(null, REF, out),
        "x-2": review.scoreRun(null, REF, null),
      },
      rulings: {},
      outputs: { "opus-xhigh-1": out, "opus-xhigh-2": out, "x-1": out, "x-2": null },
    });
    expect(s.groups["x"]!.verdict).toBe("pending: a run returned no output");
  });

  it("gives no verdict when one of the run's arms has no transcript at all", () => {
    // `bakeoff.mjs score` leaves an arm with no transcript out of checksByArm, so the
    // group would otherwise be judged on the runs that came back.
    const out = { findings: [], unverified: [] };
    const s = review.summarize({
      reference: REF,
      checksByArm: {
        "opus-xhigh-1": review.scoreRun(null, REF, out),
        "opus-xhigh-2": review.scoreRun(null, REF, out),
        "x-1": review.scoreRun(null, REF, out),
      },
      rulings: {},
      outputs: { "opus-xhigh-1": out, "opus-xhigh-2": out, "x-1": out },
      arms: ["opus-xhigh-1", "opus-xhigh-2", "x-1", "x-2"],
    });
    expect(s.perRun["x-2"]).toMatchObject({ noOutput: true, found: 0, of: 2 });
    expect(s.groups["x"]).toMatchObject({ runs: 2, verdict: "pending: a run returned no output" });
  });

  it("fails the well-formed check for a finding whose case names no case, so it cannot vanish", () => {
    const checks = review.scoreRun(
      null,
      { ...REF, cases: ["r01", "r02", "r03"] },
      {
        findings: [f("r2", "src/a.ts", 5)],
      },
    );
    expect(checks.find((c: Check) => c.field === "(well-formed)")!.ok).toBe(false);
  });

  it("reads a finding that names the case's after file as its source file", () => {
    expect(review.relation(f("r01", "cases/r01.after.a.ts", 11), REF.defects[0]!)).toBe("overlap");
    expect(review.relation(f("r01", "r01.after.other.ts", 11), REF.defects[0]!)).toBeNull();
  });

  it("takes line numbers only as numbers or digit strings", () => {
    expect(review.span({ startLine: "118", endLine: 118 })).toEqual([118, 118]);
    expect(review.span({ startLine: true, endLine: true })).toBeNull();
  });

  it("counts a defect the referee refuted on any run for no arm", () => {
    const outA = { findings: [f("r01", "src/a.ts", 11)], unverified: [] };
    const outB = { findings: [], unverified: [] };
    const checksByArm = {
      "opus-xhigh-1": review.scoreRun(null, REF, outA),
      "opus-xhigh-2": review.scoreRun(null, REF, outA),
      "x-1": review.scoreRun(null, REF, outB),
      "x-2": review.scoreRun(null, REF, outB),
    };
    const [g] = groupDisagreements({ a: checksByArm["opus-xhigh-1"] });
    const rulings = { [g!.id]: { id: g!.id, armCorrect: false, refCorrect: false } };
    const s = review.summarize({
      reference: REF,
      checksByArm,
      rulings,
      outputs: { "opus-xhigh-1": outA, "opus-xhigh-2": outA, "x-1": outB, "x-2": outB },
    });
    expect(s.refutedDefects).toEqual(["d-crit"]);
    expect(s.perRun["x-1"]).toMatchObject({ of: 1, criticalMissed: [] });
    expect(s.groups["x"]!.reasons ?? []).not.toContain("missed 2 seeded critical(s)");
  });

  it("sends nothing to the referee for a defect no finding came near", () => {
    const checks = review.scoreRun(null, REF, { findings: [], unverified: [] });
    expect(groupDisagreements({ arm: checks })).toEqual([]);
  });

  it("counts other findings on seeded cases apart from false positives", () => {
    expect(summary([f("r03", "src/b.ts", 200)])).toMatchObject({
      otherFindings: 1,
      falsePositives: 0,
    });
  });

  it("fails the well-formed check mechanically for a finding with no line range or no output", () => {
    const wf = (out: unknown) =>
      review.scoreRun(null, REF, out).find((c: Check) => c.field === "(well-formed)")!;
    expect(wf({ findings: [{ case: "r01", file: "src/a.ts" }] }).ok).toBe(false);
    expect(wf(undefined)).toMatchObject({ ok: false, mechanical: true, armKey: "no output" });
    expect(wf({ findings: [] }).ok).toBe(true);
  });
});

describe("the decision rule", () => {
  const run = (found: number, criticalMissed: string[] = [], falsePositives = 0): RunSummary => ({
    found,
    of: 9,
    missed: [],
    criticalFound: 4 - criticalMissed.length,
    criticalOf: 4,
    criticalMissed,
    controlFindings: falsePositives,
    falsePositives,
    realOnControls: 0,
    otherFindings: 0,
    unruled: 0,
    disputedDefects: [],
    upheldDefects: [],
    noOutput: false,
  });

  it("gives no verdict while anything is unruled", () => {
    const g = review.decide({
      "opus-xhigh-1": run(8),
      "opus-xhigh-2": run(8),
      "opus-low-1": run(8),
      "opus-low-2": { ...run(8), unruled: 1 },
    });
    expect(g["opus-low"]!.verdict).toMatch(/^pending/);
  });

  it("puts an arm within tolerance when it is close on recall and false positives", () => {
    const g = review.decide({
      "opus-xhigh-1": run(8),
      "opus-xhigh-2": run(8),
      "sonnet-high-1": run(7, [], 1),
      "sonnet-high-2": run(7, [], 1),
    });
    expect(g["opus-xhigh"]!.verdict).toBe("comparator");
    expect(g["sonnet-high"]).toMatchObject({ runs: 2, found: 14, verdict: "within" });
  });

  it("puts an arm outside when it misses one seeded critical, however good its recall", () => {
    const g = review.decide({
      "opus-xhigh-1": run(7),
      "opus-xhigh-2": run(7),
      "opus-low-1": run(9),
      "opus-low-2": run(8, ["d5-clone-argv-injection"]),
    });
    expect(g["opus-low"]!.verdict).toBe("outside");
    expect(g["opus-low"]!.reasons).toEqual(["missed 1 seeded critical(s)"]);
  });

  it("puts an arm outside past the recall or false-positive slack", () => {
    const g = review.decide({
      "opus-xhigh-1": run(8),
      "opus-xhigh-2": run(8),
      "sonnet-medium-1": run(6),
      "sonnet-medium-2": run(7),
      "opus-low-1": run(8, [], 2),
      "opus-low-2": run(8, [], 1),
    });
    expect(g["sonnet-medium"]!.reasons).toEqual(["found 13, below 14"]);
    expect(g["opus-low"]!.reasons).toEqual(["3 false positives, above 2"]);
  });
});

describe("scorerFor", () => {
  it("uses the task's own scorer where it exports one, and lib/score.mjs's otherwise", () => {
    expect(scorerFor(review).scoreRun).toBe(review.scoreRun);
    expect(scorerFor(census).scoreRun).not.toBe(review.scoreRun);
    expect(scorerFor(census).scoreRun.name).toBe("scoreRun");
  });

  it("gives every arm an explicit effort", () => {
    for (const a of [...review.arms, review.gold]) expect(a.effort).toBeTruthy();
    expect(review.arms.filter((a) => a.id.endsWith("-1"))).toHaveLength(5);
  });
});
