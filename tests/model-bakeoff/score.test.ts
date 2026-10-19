import { describe, it, expect } from "vitest";
import {
  MISSING,
  finalScores,
  groupDisagreements,
  normalise,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";

describe("normalise", () => {
  it("unifies dash variants, so an en dash in a cron range equals a hyphen", () => {
    expect(normalise("0 9 * * 1–5", "string")).toBe(normalise("0 9 * * 1-5", "string"));
    expect(normalise("a—b−c‐d", "string")).toBe("a-b-c-d");
  });

  it("collapses whitespace and trims", () => {
    expect(normalise("  0  9 *\t* 1 ", "string")).toBe("0 9 * * 1");
  });

  it("folds case", () => {
    expect(normalise("Fleet Smoke", "string")).toBe(normalise("fleet smoke", "string"));
  });

  it("folds punctuation for text and name, but not for string", () => {
    expect(normalise("co-producer.", "text")).toBe("coproducer");
    expect(normalise("co-producer.", "string")).toBe("co-producer.");
  });

  it("drops a title prefix for name only", () => {
    expect(normalise("Det. Jane Roe", "name")).toBe(normalise("Jane Roe", "name"));
    expect(normalise("Detective Jane Roe", "name")).toBe("janeroe");
    expect(normalise("Det. Jane Roe", "text")).not.toBe(normalise("Jane Roe", "text"));
  });

  it("compares sets without regard to order, duplicates or empty members", () => {
    expect(normalise(["b", "a", "a", ""], "set:string")).toBe(normalise(["a", "b"], "set:string"));
    expect(normalise([], "set:string")).toBe("[]");
    expect(normalise(undefined, "set:string")).toBe("[]");
  });

  it("keeps a member containing the old separator distinct from two members", () => {
    expect(normalise(["a|b"], "set:string")).not.toBe(normalise(["a", "b"], "set:string"));
  });

  it("reads numbers strictly: blank, null and hex are not numbers", () => {
    expect(normalise("42", "number")).toBe("42");
    expect(normalise(42, "number")).toBe("42");
    expect(normalise(" 4.50 ", "number")).toBe("4.5");
    for (const v of ["", " ", null, undefined, "0x10", "forty"]) {
      expect(normalise(v, "number"), String(v)).not.toBe(normalise(0, "number"));
      expect(normalise(v, "number"), String(v)).toMatch(/^NaN:/);
    }
  });

  it("reads booleans strictly", () => {
    expect(normalise("false", "boolean")).toBe("false");
    expect(normalise("yes", "boolean")).not.toBe("true");
  });

  it("keys files by base name", () => {
    expect(normalise(".github/workflows/CI.yml", "file")).toBe("ci.yml");
  });

  it("takes a task's own kind", () => {
    const kinds = { tolerance: (v: unknown) => Math.round(Number(v)) };
    expect(normalise("4.4", "tolerance", kinds)).toBe(normalise(3.6, "tolerance", kinds));
    expect(normalise(["4.4", "1"], "set:tolerance", kinds)).toBe('["1","4"]');
  });
});

const spec = {
  collections: [
    {
      name: "workflows",
      key: "file",
      keyKind: "file",
      fields: { crons: "set:string", jobs: "number" },
    },
  ],
};
const ref = {
  workflows: [
    { file: "a.yml", crons: ["0 9 * * 1-5"], jobs: 2 },
    { file: "b.yml", crons: [], jobs: 0 },
  ],
};

describe("scoreRun", () => {
  it("passes every check on equivalent output", () => {
    const out = {
      workflows: [
        { file: "workflows/b.yml", crons: [], jobs: "0" },
        { file: "A.yml", crons: ["0 9 * * 1–5"], jobs: 2 },
      ],
    };
    const checks = scoreRun(spec, ref, out);
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails a wrong value and marks a missing item", () => {
    const checks = scoreRun(spec, ref, { workflows: [{ file: "a.yml", crons: [], jobs: 2 }] });
    expect(checks.filter((c) => !c.ok).map((c) => c.check)).toEqual([
      "workflows a.yml / crons",
      "workflows b.yml / crons",
      "workflows b.yml / jobs",
    ]);
    expect(checks.find((c) => c.check === "workflows b.yml / jobs")?.armRaw).toBe(MISSING);
  });

  it("never credits a field the arm left out, even where the reference is 0 or empty", () => {
    const checks = scoreRun(spec, ref, {
      workflows: [ref.workflows[0], { file: "b.yml" }],
    });
    const b = checks.filter((c) => c.key === "b.yml");
    expect(b.map((c) => [c.field, c.ok, c.armKey])).toEqual([
      ["crons", false, MISSING],
      ["jobs", false, MISSING],
    ]);
  });

  it("fails an invented item and a duplicate, in one check per collection", () => {
    const out = {
      workflows: [...ref.workflows, { file: "invented.yml", crons: [], jobs: 1 }, ref.workflows[0]],
    };
    const checks = scoreRun(spec, ref, out);
    const extra = checks.find((c) => c.field === "(no extra or duplicate items)")!;
    expect(extra.ok).toBe(false);
    expect(JSON.parse(extra.armRaw)).toEqual({ extras: ["invented.yml"], duplicates: ["a.yml"] });
    expect(checks.filter((c) => !c.ok)).toHaveLength(1);
  });

  it("keeps the first of two entries for one key rather than the last", () => {
    const out = { workflows: [ref.workflows[0], ref.workflows[1], { file: "a.yml", jobs: 9 }] };
    const jobs = scoreRun(spec, ref, out).find((c) => c.check === "workflows a.yml / jobs")!;
    expect(jobs.ok).toBe(true);
  });
});

describe("disagreements and rulings", () => {
  const bad = { workflows: [{ file: "a.yml", crons: [], jobs: 3 }, ref.workflows[1]] };
  const checksByArm = {
    x: scoreRun(spec, ref, bad),
    y: scoreRun(spec, ref, bad),
  };

  it("groups the same wrong value from two arms into one disagreement", () => {
    const d = groupDisagreements(checksByArm);
    expect(d.map((g) => [g.check, g.arms])).toEqual([
      ["workflows a.yml / crons", ["x", "y"]],
      ["workflows a.yml / jobs", ["x", "y"]],
    ]);
  });

  it("sends an explicit value to the referee even when another arm left the field out", () => {
    const d = groupDisagreements({
      a: scoreRun(spec, ref, { workflows: [{ file: "b.yml", crons: [] }] }),
      b: scoreRun(spec, ref, { workflows: [{ file: "b.yml", crons: [], jobs: 7 }] }),
    });
    const jobs = d.filter((g) => g.check === "workflows b.yml / jobs");
    expect(jobs).toEqual([expect.objectContaining({ armRaw: "7", arms: ["b"] })]);
  });

  it("credits an arm the referee rules correct, and records a wrong reference", () => {
    const [crons] = groupDisagreements(checksByArm);
    const rulings = {
      [crons!.id]: { id: crons!.id, armCorrect: true, refCorrect: false, note: "n" },
    };
    const { per, referenceErrors } = finalScores(checksByArm, rulings);
    expect(per.x).toMatchObject({ total: 5, correct: 4, unruled: 1 });
    expect(referenceErrors).toEqual([
      { check: "workflows a.yml / crons", reference: '["0 9 * * 1-5"]', note: "n" },
    ]);
  });

  it("fails an arm that agrees with a reference the referee ruled wrong, and says so", () => {
    const withAgreer = { ...checksByArm, w: scoreRun(spec, ref, ref) };
    const [crons] = groupDisagreements(withAgreer);
    const rulings = {
      [crons!.id]: { id: crons!.id, armCorrect: true, refCorrect: false, note: "it is []" },
    };
    const { per } = finalScores(withAgreer, rulings);
    expect(per.w).toMatchObject({ total: 5, correct: 4 });
    expect(per.w!.errors).toEqual([
      {
        check: "workflows a.yml / crons",
        got: '["0 9 * * 1-5"]',
        expected: 'not ["0 9 * * 1-5"] (the referee refuted the reference: it is [])',
      },
    ]);
  });

  it("never credits a missing value, whatever a ruling says", () => {
    const missing = scoreRun(spec, ref, { workflows: [] });
    const id = `workflows a.yml / jobs :: ${MISSING}`;
    const { per } = finalScores(
      { z: missing },
      { [id]: { id, armCorrect: true, refCorrect: true } },
    );
    expect(per.z!.errors.map((e) => e.check)).toContain("workflows a.yml / jobs");
    expect(per.z!.correct).toBe(1);
  });
});
