import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRun } from "../../scripts/model-bakeoff/lib/arms.mjs";
import { finalScores, scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";
import { refutePrompt } from "../../scripts/meta-week/lib/refute-claims.mjs";
import * as task from "../../scripts/model-bakeoff/tasks/refute-claims.mjs";

const read = (p: string) =>
  JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const seeded = read(task.SEEDED_FILE) as { id: string; claim: string; kind?: string }[];
const key = read(task.KEY_FILE) as { expected: Record<string, { verdict: string }> };

const DIR = "/frozen/input";
const FALSE = ["c01", "c04", "c07", "c09", "c12", "c15", "c17"];

type V = { id: string; verdict: string; quote?: string; quoteSource?: string };

// A perfect output as a production skeptic would give it: every confirmation carries a
// quote from its own first evidence path, which `enforceQuoteRule` demands.
function perfect(): { verdicts: V[] } {
  return {
    verdicts: task.claims().map((c) => ({
      id: c.id,
      verdict: key.expected[c.id]!.verdict,
      quote: "the line",
      quoteSource: `${DIR}/${c.evidence[0]}`,
    })),
  };
}

function withVerdicts(changes: Record<string, string>) {
  const out = perfect();
  for (const v of out.verdicts) if (changes[v.id]) v.verdict = changes[v.id]!;
  return out;
}

describe("refute-claims task: inputs", () => {
  it("keeps the seeded control's ids, order, text and kind; only the evidence moves", () => {
    const got = task.claims();
    expect(got.map((c) => c.id)).toEqual(seeded.map((c) => c.id));
    for (const [i, c] of got.entries()) {
      expect(c.claim).toBe(seeded[i]!.claim);
      expect(c.kind).toBe(seeded[i]!.kind ?? "docs");
      for (const e of c.evidence) expect(e).toMatch(/^(corpus|meta)\/[\w.-]+\.md:\d+(-\d+)?$/);
    }
  });

  it("cites only pages it pins or the in-repo token meter", () => {
    const paths = new Set(task.claims().flatMap((c) => c.evidence.map((e) => e.split(":")[0])));
    for (const p of paths) {
      expect(p === "meta/10-token-meter.md" || p! in task.PAGES, p).toBe(true);
    }
  });

  it("has a label for every claim, with the seven false claims and c03 untested", () => {
    expect(Object.keys(key.expected).sort()).toEqual(seeded.map((c) => c.id).sort());
    const labels = task.labels(key).verdicts;
    expect(
      labels
        .filter((v) => v.verdict === "refuted")
        .map((v) => v.id)
        .sort(),
    ).toEqual(FALSE);
    expect(labels.find((v) => v.id === "c03")!.verdict).toBe("untested");
    expect(seeded.find((c) => c.id === "c03")!.kind).toBe("behavior");
  });

  it("gives every arm the production skeptic prompt for every claim, and never the key", () => {
    const p = task.prompt(DIR);
    for (const c of task.claims()) expect(p).toContain(refutePrompt(c, DIR));
    expect(p).not.toContain("expected");
    expect(p).not.toContain("_data");
    expect(task.goldAddendum).toBe("");
  });

  it("refuses a frozen corpus that is not the pinned copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "refute-pages-"));
    mkdirSync(join(dir, "corpus"));
    for (const p of Object.keys(task.PAGES)) writeFileSync(join(dir, p), "drifted\n");
    expect(() => task.truth(dir)).toThrow(/not the copy the anchors were written against/);
  });
});

describe("refute-claims task: the scorer, proved before any arm runs", () => {
  it("scores the truth against itself as perfect", () => {
    const ref = task.labels(key);
    const checks = scoreRun(task, ref, ref);
    expect(checks.length).toBe(17 * 2 + 1);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(finalScores({ self: checks }).per.self).toMatchObject({ correct: 35, total: 35 });
  });

  it("fails a perturbed copy exactly where it was changed", () => {
    const ref = task.labels(key);
    const bad = JSON.parse(JSON.stringify(ref));
    bad.verdicts.find((v: V) => v.id === "c17").verdict = "confirmed";
    bad.verdicts = bad.verdicts.filter((v: V) => v.id !== "c05");
    const failed = scoreRun(task, ref, bad)
      .filter((c) => !c.ok)
      .map((c) => c.check)
      .sort();
    expect(failed).toEqual([
      "verdicts c05 / (present)",
      "verdicts c05 / verdict",
      "verdicts c17 / verdict",
    ]);
  });

  it("counts every catch on a perfect run, and no wrong refutation", () => {
    const t = task.tally(perfect(), DIR, key);
    expect(t).toMatchObject({
      falseClaims: 7,
      catches: 7,
      missed: [],
      trueClaims: 10,
      wrongRefutations: 0,
      wrong: [],
      unclearOnTrue: [],
      noVerdict: [],
      downgraded: [],
    });
    expect(task.passes(t)).toBe(true);
  });

  it("counts a missed false claim, and a run with one fails", () => {
    const t = task.tally(withVerdicts({ c17: "unclear" }), DIR, key);
    expect(t.catches).toBe(6);
    expect(t.missed).toEqual(["c17"]);
    expect(task.passes(t)).toBe(false);
  });

  it("counts wrong refutations of true claims, c03 included", () => {
    const t = task.tally(withVerdicts({ c02: "refuted", c03: "refuted" }), DIR, key);
    expect(t.wrongRefutations).toBe(2);
    expect(t.wrong).toEqual(["c02", "c03"]);
    expect(t.catches).toBe(7);
  });

  it("allows one wrong refutation and fails two, the workflow's ship line", () => {
    expect(task.SHIP_LINE).toBe(2);
    const one = task.tally(withVerdicts({ c02: "refuted" }), DIR, key);
    expect(task.passes(one)).toBe(true);
    const two = task.tally(withVerdicts({ c02: "refuted", c05: "refuted" }), DIR, key);
    expect(task.passes(two)).toBe(false);
  });

  it("applies the workflow's quote rule before counting", () => {
    const out = perfect();
    const c02 = out.verdicts.find((v) => v.id === "c02")!;
    c02.quote = "";
    const c03 = out.verdicts.find((v) => v.id === "c03")!;
    c03.verdict = "confirmed";
    const t = task.tally(out, DIR, key);
    expect(t.downgraded).toEqual(["c02", "c03"]);
    expect(t.unclearOnTrue).toEqual(["c02"]);
    expect(t.wrongRefutations).toBe(0);
  });

  it("counts a claim left out as a miss or a non-confirmation, never a pass", () => {
    const out = perfect();
    out.verdicts = out.verdicts.filter((v) => v.id !== "c07" && v.id !== "c08");
    const t = task.tally(out, DIR, key);
    expect(t.noVerdict).toEqual(["c07", "c08"]);
    expect(t.missed).toEqual(["c07"]);
    expect(t.unclearOnTrue).toEqual(["c08"]);
    expect(task.passes(t)).toBe(false);
  });
});

describe("refute-claims task: arms", () => {
  it("names a model and an effort on every arm, two runs of each, and the gold at xhigh", () => {
    expect(validateRun(task.arms, task.gold)).toEqual([]);
    expect(task.gold).toEqual({ id: "gold", model: "opus", effort: "xhigh" });
    const per = new Map<string, number>();
    for (const a of task.arms)
      per.set(`${a.model}@${a.effort}`, (per.get(`${a.model}@${a.effort}`) ?? 0) + 1);
    expect([...per.keys()].sort()).toEqual([
      "opus@low",
      "opus@medium",
      "sonnet@high",
      "sonnet@medium",
    ]);
    for (const n of per.values()) expect(n).toBe(2);
  });

  it("is refused by the harness when an arm has no effort", () => {
    const arms = task.arms.map((a, i) => (i === 0 ? { id: a.id, model: a.model } : a));
    expect(validateRun(arms as typeof task.arms, task.gold).join("\n")).toMatch(/has no effort/);
  });
});
