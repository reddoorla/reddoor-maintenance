import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, it, expect } from "vitest";
import {
  MISSING,
  extraCandidates,
  finalScores,
  groupDisagreements,
  normalise,
  referenceFaults,
  scoreRun,
} from "../../scripts/model-bakeoff/lib/score.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";

// t5-census's input as `prepare` builds it from this repository: its sources, copied.
const CENSUS_INPUT = mkdtempSync(join(tmpdir(), "score-census-"));
afterAll(() => rmSync(CENSUS_INPUT, { recursive: true, force: true }));
for (const s of census.sources) {
  const from = resolve(import.meta.dirname, "../..", s.from);
  mkdirSync(join(CENSUS_INPUT, s.to), { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (s.match.test(name) && statSync(src).isFile())
      copyFileSync(src, join(CENSUS_INPUT, s.to, name));
  }
}

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
    expect(checks).toHaveLength(7);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails a wrong value and marks a missing item", () => {
    const checks = scoreRun(spec, ref, { workflows: [{ file: "a.yml", crons: [], jobs: 2 }] });
    expect(checks.filter((c) => !c.ok).map((c) => c.check)).toEqual([
      "workflows a.yml / crons",
      "workflows b.yml / (present)",
      "workflows b.yml / crons",
      "workflows b.yml / jobs",
    ]);
    expect(checks.find((c) => c.check === "workflows b.yml / jobs")?.armRaw).toBe(MISSING);
  });

  it("never credits a field the arm left out, even where the reference is 0 or empty", () => {
    const checks = scoreRun(spec, ref, {
      workflows: [ref.workflows[0], { file: "b.yml" }],
    });
    const b = checks.filter((c) => c.key === "b.yml" && c.field !== "(present)");
    expect(b.map((c) => [c.field, c.ok, c.armKey])).toEqual([
      ["crons", false, MISSING],
      ["jobs", false, MISSING],
    ]);
  });

  it("fails an invented item and a duplicate, each in its own check", () => {
    const out = {
      workflows: [...ref.workflows, { file: "invented.yml", crons: [], jobs: 1 }, ref.workflows[0]],
    };
    const checks = scoreRun(spec, ref, out);
    expect(checks.filter((c) => !c.ok).map((c) => [c.check, c.armRaw])).toEqual([
      ["workflows invented.yml / (extra)", 'listed, as "invented.yml"'],
      ["workflows / (well-formed)", JSON.stringify({ duplicates: ["a.yml"], keyless: 0 })],
    ]);
  });

  it("gives every arm the same check for each item any arm listed, keyed per item", () => {
    const outputs = {
      a: { workflows: [...ref.workflows, { file: "real.yml" }] },
      b: { workflows: ref.workflows },
      e: { workflows: [...ref.workflows, { file: "bogus.yml" }] },
    };
    const candidates = extraCandidates(spec, ref, Object.values(outputs));
    const checksByArm = Object.fromEntries(
      Object.entries(outputs).map(([k, o]) => [k, scoreRun(spec, ref, o, candidates)]),
    );
    const d = groupDisagreements(checksByArm);
    expect(d.map((g) => [g.check, g.arms])).toEqual([
      ["workflows real.yml / (extra)", ["a"]],
      ["workflows bogus.yml / (extra)", ["e"]],
    ]);
    const rulings = {
      [d[0]!.id]: { id: d[0]!.id, armCorrect: true, refCorrect: false, note: "real.yml exists" },
      [d[1]!.id]: { id: d[1]!.id, armCorrect: false, refCorrect: true },
    };
    const { per, contradictions, referenceErrors } = finalScores(checksByArm, rulings);
    expect(contradictions).toEqual([]);
    expect(referenceErrors.map((e) => e.check)).toEqual(["workflows real.yml / (extra)"]);
    expect([per.a, per.b, per.e].map((p) => [p!.total, p!.correct])).toEqual([
      [9, 9],
      [9, 8],
      [9, 7],
    ]);
  });

  it("reports an extra item ruled real, whose field values went unscored", () => {
    const outputs = { a: { workflows: [...ref.workflows, { file: "real.yml", jobs: 9999 }] } };
    const candidates = extraCandidates(spec, ref, Object.values(outputs));
    const checksByArm = { a: scoreRun(spec, ref, outputs.a, candidates) };
    const [g] = groupDisagreements(checksByArm);
    const { realExtras, per } = finalScores(checksByArm, {
      [g!.id]: { id: g!.id, armCorrect: true, refCorrect: false },
    });
    expect(realExtras).toEqual(["workflows real.yml / (extra)"]);
    expect(per.a!.correct).toBe(per.a!.total);
  });

  it("treats a ruling where both or neither side of a presence or extra check is right as contested", () => {
    const outputs = { a: { workflows: [...ref.workflows, { file: "x.yml" }] }, b: ref };
    const candidates = extraCandidates(spec, ref, Object.values(outputs));
    const checksByArm = Object.fromEntries(
      Object.entries(outputs).map(([k, o]) => [k, scoreRun(spec, ref, o, candidates)]),
    );
    const [g] = groupDisagreements(checksByArm);
    const both = finalScores(checksByArm, {
      [g!.id]: { id: g!.id, armCorrect: true, refCorrect: true },
    });
    expect(both.contradictions).toEqual(["workflows x.yml / (extra)"]);
  });

  it("says what a refuted presence or extra check expected, without a double negative", () => {
    const outputs = { a: { workflows: [...ref.workflows, { file: "real.yml" }] }, b: ref };
    const candidates = extraCandidates(spec, ref, Object.values(outputs));
    const checksByArm = Object.fromEntries(
      Object.entries(outputs).map(([k, o]) => [k, scoreRun(spec, ref, o, candidates)]),
    );
    const [g] = groupDisagreements(checksByArm);
    const { per } = finalScores(checksByArm, {
      [g!.id]: { id: g!.id, armCorrect: true, refCorrect: false, note: "it exists" },
    });
    expect(per.b!.errors[0]!.expected).toBe(
      "listed (the referee refuted the reference: it exists)",
    );
  });

  it("names an extra item the same whatever order the arms come in", () => {
    const a = { workflows: [{ file: "dir/Real.yml" }] };
    const b = { workflows: [{ file: "real.yml" }] };
    expect(extraCandidates(spec, ref, [a, b])).toEqual(extraCandidates(spec, ref, [b, a]));
  });

  it("fails a keyless item and a missing output mechanically, never as a candidate", () => {
    const keyless = { workflows: [...ref.workflows, { jobs: 3 }, { file: "dir/" }] };
    expect(extraCandidates(spec, ref, [keyless]).workflows).toEqual([]);
    const wf = scoreRun(spec, ref, keyless).find((c) => c.field === "(well-formed)")!;
    expect(JSON.parse(wf.armRaw)).toEqual({ duplicates: [], keyless: 2 });
    const none = scoreRun(spec, ref, null).find((c) => c.field === "(well-formed)")!;
    expect([none.ok, none.armRaw]).toEqual([false, '{"noOutput":true}']);
  });

  it("never sends a duplicate to the referee", () => {
    const twice = scoreRun(spec, ref, { workflows: [...ref.workflows, ref.workflows[0]] });
    expect(groupDisagreements({ twice })).toEqual([]);
    expect(finalScores({ twice }).per.twice).toMatchObject({ total: 7, correct: 6, unruled: 0 });
  });

  it("reports a reference that lists one item twice, or an item with no key", () => {
    expect(
      referenceFaults(spec, { workflows: [...ref.workflows, ref.workflows[1], { jobs: 1 }] }),
    ).toEqual([
      "the reference lists workflows b.yml more than once; the first entry is used",
      "the reference has 1 workflows item(s) with no file; they are not scored",
    ]);
  });

  it("reports a reference item that lacks a field its collection scores", () => {
    // An older truth.json shape: every arm would be charged on the absent field, silently.
    const old = { workflows: [{ file: "a.yml", jobs: 2 }, { file: "b.yml" }, ref.workflows[1]] };
    expect(referenceFaults(spec, old)).toEqual([
      "the reference lists workflows b.yml more than once; the first entry is used",
      "the reference gives no crons for workflows a.yml, b.yml; every arm would be charged on it",
      "the reference gives no jobs for workflows b.yml; every arm would be charged on it",
    ]);
    expect(referenceFaults(spec, ref)).toEqual([]);
  });

  it("finds no fault in t5-census's real reference", () => {
    const real = census.truth(CENSUS_INPUT);
    expect(real.workflows.length).toBeGreaterThan(10);
    expect(real.scripts.length).toBeGreaterThan(10);
    expect(referenceFaults(census, real)).toEqual([]);
  });

  it("keys an extra item by its normalised key, so a new spelling keeps the ruling", () => {
    const a = { workflows: [...ref.workflows, { file: "ci.yml" }] };
    const b = { workflows: [...ref.workflows, { file: "CI.yml" }] };
    const one = groupDisagreements({ a: scoreRun(spec, ref, a, extraCandidates(spec, ref, [a])) });
    const two = groupDisagreements({
      a: scoreRun(spec, ref, a, extraCandidates(spec, ref, [a, b])),
      b: scoreRun(spec, ref, b, extraCandidates(spec, ref, [a, b])),
    });
    expect(two.map((g) => g.id)).toEqual(one.map((g) => g.id));
    expect(one[0]!.armRaw).toBe('listed, as "ci.yml"');
  });

  it("fails an arm with no output mechanically, without a referee round", () => {
    const { per } = finalScores({ none: scoreRun(spec, ref, null) });
    expect(groupDisagreements({ none: scoreRun(spec, ref, null) })).toEqual([]);
    expect(per.none).toMatchObject({ correct: 0, unruled: 0 });
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
    expect(per.x).toMatchObject({ total: 7, correct: 6, unruled: 1 });
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
    expect(per.w).toMatchObject({ total: 7, correct: 6 });
    expect(per.w!.errors).toEqual([
      {
        check: "workflows a.yml / crons",
        got: '["0 9 * * 1-5"]',
        expected: 'not ["0 9 * * 1-5"] (the referee refuted the reference: it is [])',
      },
    ]);
  });

  it("sends an item the arm omitted to the referee, and drops it for everyone if refuted", () => {
    const omits = scoreRun(spec, ref, { workflows: [ref.workflows[0]] });
    const copies = scoreRun(spec, ref, ref);
    const [presence] = groupDisagreements({ omits, copies });
    expect(presence).toMatchObject({ check: "workflows b.yml / (present)", armRaw: "absent" });
    const rulings = {
      [presence!.id]: { id: presence!.id, armCorrect: true, refCorrect: false, note: "no b.yml" },
    };
    const { per } = finalScores({ omits, copies }, rulings);
    expect(per.omits).toMatchObject({ total: 5, correct: 5 });
    expect(per.copies).toMatchObject({ total: 5, correct: 4 });
  });

  it("reports contradictory rulings on one check instead of applying either", () => {
    const arms = {
      a: scoreRun(spec, ref, ref),
      b: scoreRun(spec, ref, { workflows: [{ ...ref.workflows[0], jobs: 3 }, ref.workflows[1]] }),
      c: scoreRun(spec, ref, { workflows: [{ ...ref.workflows[0], jobs: 4 }, ref.workflows[1]] }),
    };
    const d = groupDisagreements(arms);
    const rulings = Object.fromEntries(
      d.map((g, i) => [g.id, { id: g.id, armCorrect: false, refCorrect: i === 0 ? false : true }]),
    );
    const { per, contradictions } = finalScores(arms, rulings);
    expect(contradictions).toEqual(["workflows a.yml / jobs"]);
    expect(per.a!.correct).toBe(per.a!.total);
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
