import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { groupDisagreements, disagreementId } from "../../scripts/model-bakeoff/lib/score.mjs";
import { scorerFor } from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";
import * as review from "../../scripts/model-bakeoff/tasks/seeded-review.mjs";
import { cleanDiff } from "../../scripts/model-bakeoff/tasks/seeded-review/build.mjs";
import type {
  Check,
  Finding,
  Reference,
  RunSummary,
} from "../../scripts/model-bakeoff/tasks/seeded-review.mjs";

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

const summary = (findings: Finding[], rulings = {}) => {
  const out = { findings, unverified: [] };
  return review.runSummary(REF, review.scoreRun(null, REF, out), rulings, out);
};

describe("seeded-review key", () => {
  it("fits the frozen cases: every file exists and every anchor sits in its range", () => {
    const t = review.truth(CASES);
    expect(t.defects).toHaveLength(9);
    expect(t.defects.filter((d) => d.critical).map((d) => d.id)).toEqual([
      "d2-period-overlap",
      "d5-clone-argv-injection",
      "d6-clone-path-traversal",
      "d7-uid-lookup-collision",
    ]);
    expect(t.controls.map((c) => c.case)).toEqual(["r02", "r06", "r10"]);
  });

  it("drops index lines so a diff names no blob to look up", () => {
    expect(cleanDiff("diff --git a/x b/x\nindex 1a2b..3c4d 100644\n--- a/x\n+b")).toBe(
      "diff --git a/x b/x\n--- a/x\n+b",
    );
  });
});

describe("matching a finding to a seeded defect", () => {
  it("matches the right case and file when the ranges overlap, by path suffix too", () => {
    expect(review.relation(f("r01", "src/a.ts", 12, 15), REF.defects[0]!)).toBe("match");
    expect(review.relation(f("R01", "b/src/a.ts", 9, 10), REF.defects[0]!)).toBe("match");
    expect(review.relation(f("r01", "a.ts", 11), REF.defects[0]!)).toBe("match");
    expect(review.relation(f("r03", "src/b.ts", 91), REF.defects[1]!)).toBe("match");
  });

  it("never matches a finding in the wrong file, even on the same lines", () => {
    expect(review.relation(f("r01", "src/other.ts", 10, 12), REF.defects[0]!)).toBeNull();
    expect(review.relation(f("r01", "lib/src/a.ts.bak", 10, 12), REF.defects[0]!)).toBeNull();
    expect(summary([f("r01", "src/other.ts", 10, 12)]).found).toBe(0);
  });

  it("never matches a finding in the wrong case", () => {
    expect(review.relation(f("r03", "src/a.ts", 10, 12), REF.defects[0]!)).toBeNull();
  });

  it("sends a near miss and a too-wide finding to the referee, not to a match", () => {
    expect(review.relation(f("r01", "src/a.ts", 20), REF.defects[0]!)).toBe("near");
    expect(review.relation(f("r01", "src/a.ts", 23), REF.defects[0]!)).toBeNull();
    expect(review.relation(f("r01", "src/a.ts", 1, 40), REF.defects[0]!)).toBe("near");
    expect(review.relation({ case: "r01", file: "src/a.ts" }, REF.defects[0]!)).toBeNull();
  });
});

describe("scoring one run", () => {
  it("scores the key against itself as perfect", () => {
    const self = REF.defects.map((d) => f(d.case, d.file, d.ranges[0]![0], d.ranges[0]![1]));
    expect(summary(self)).toMatchObject({
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
    expect(summary(self)).toMatchObject({
      found: 1,
      missed: ["d-crit"],
      criticalMissed: ["d-crit"],
    });
  });

  it("counts a finding on a clean control as a false positive, never as a hit", () => {
    const s = summary([f("r02", "src/a.ts", 10, 12)]);
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
