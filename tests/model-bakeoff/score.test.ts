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
    expect(normalise([], "set:string")).toBe("");
    expect(normalise(undefined, "set:string")).toBe("");
  });

  it("reads numbers and booleans strictly", () => {
    expect(normalise("42", "number")).toBe("42");
    expect(normalise(42, "number")).toBe("42");
    expect(normalise("forty", "number")).not.toBe(normalise(40, "number"));
    expect(normalise("false", "boolean")).toBe("false");
    expect(normalise("yes", "boolean")).not.toBe("true");
  });

  it("keys files by base name", () => {
    expect(normalise(".github/workflows/CI.yml", "file")).toBe("ci.yml");
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
    { file: "b.yml", crons: [], jobs: 1 },
  ],
};

describe("scoreRun", () => {
  it("passes every check on equivalent output", () => {
    const out = {
      workflows: [
        { file: "workflows/b.yml", crons: [], jobs: "1" },
        { file: "A.yml", crons: ["0 9 * * 1–5"], jobs: 2 },
      ],
    };
    const checks = scoreRun(spec, ref, out);
    expect(checks).toHaveLength(4);
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

  it("credits an arm the referee rules correct, and records a wrong reference", () => {
    const [crons] = groupDisagreements(checksByArm);
    const rulings = {
      [crons!.id]: { id: crons!.id, armCorrect: true, refCorrect: false, note: "n" },
    };
    const { per, referenceErrors } = finalScores(checksByArm, rulings);
    expect(per.x).toMatchObject({ total: 4, correct: 3, unruled: 1 });
    expect(referenceErrors).toEqual([
      { check: "workflows a.yml / crons", reference: '["0 9 * * 1-5"]', note: "n" },
    ]);
  });

  it("fails an arm that agrees with a reference the referee ruled wrong", () => {
    const withAgreer = { ...checksByArm, w: scoreRun(spec, ref, ref) };
    const [crons] = groupDisagreements(withAgreer);
    const rulings = {
      [crons!.id]: { id: crons!.id, armCorrect: true, refCorrect: false },
    };
    const { per } = finalScores(withAgreer, rulings);
    expect(per.w).toMatchObject({ total: 4, correct: 3 });
    expect(per.w!.errors.map((e) => e.check)).toEqual(["workflows a.yml / crons"]);
  });

  it("never credits a missing value, whatever a ruling says", () => {
    const missing = scoreRun(spec, ref, { workflows: [] });
    const id = `workflows a.yml / jobs :: ${MISSING}`;
    const { per } = finalScores(
      { z: missing },
      { [id]: { id, armCorrect: true, refCorrect: true } },
    );
    expect(per.z!.correct).toBe(0);
  });
});
