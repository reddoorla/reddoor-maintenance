import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as task from "../../scripts/model-bakeoff/tasks/refute-repo.mjs";
import {
  parseEvidenceRef,
  refutePrompt,
  verdictSchema,
} from "../../scripts/meta-week/lib/refute-claims.mjs";
import { disagreementId, scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";
import { readAgentTranscript } from "../../scripts/model-bakeoff/lib/transcripts.mjs";
import { runWorkflow } from "../_helpers/bakeoff-workflow.js";
import {
  combineItems,
  expectedWork,
  extractArgs,
  formatResult,
  launchers,
  manifest,
  mergeAgents,
  secretReads,
  refereeArgsPath,
  runsPath,
  truthPath,
  type Collected,
} from "../../scripts/model-bakeoff/bakeoff.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW = join(REPO, ".claude/workflows/model-bakeoff.workflow.js");
const { DATA } = task;

const pinned = (from: string) =>
  execFileSync("git", ["show", `${DATA.pin}:${from}`], { cwd: REPO, encoding: "utf8" });
const lines: Record<string, string[]> = Object.fromEntries(
  Object.entries(DATA.files).map(([to, f]) => [to, pinned(f.from).split("\n")]),
);

describe("the refute-repo key", () => {
  it("has 30+ claims, 10+ of them false, under opaque shuffled ids", () => {
    expect(DATA.claims.length).toBeGreaterThanOrEqual(30);
    expect(DATA.claims.filter((c) => c.label === "refuted").length).toBeGreaterThanOrEqual(10);
    expect(DATA.claims.map((c) => c.id)).toEqual(
      DATA.claims.map((_, i) => `r${String(i + 1).padStart(2, "0")}`),
    );
    // No run of more than three claims shares a label, so position gives nothing away.
    let run = 1;
    for (let i = 1; i < DATA.claims.length; i++) {
      run = DATA.claims[i]!.label === DATA.claims[i - 1]!.label ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(3);
    }
  });

  it("gives each kind only a label its verdict schema can return", () => {
    for (const c of DATA.claims) {
      const { verdict } = verdictSchema(c.kind ?? "docs").properties as {
        verdict: { enum: string[] };
      };
      const allowed = verdict.enum;
      expect(allowed, c.id).toContain(c.label);
      expect(c.label, c.id).not.toBe("unclear");
    }
  });

  it("pins every file to bytes that git can re-fetch at the pin", () => {
    for (const f of Object.values(DATA.files)) {
      const sha = createHash("sha256").update(pinned(f.from)).digest("hex");
      expect(sha, f.from).toBe(f.sha256);
    }
  });

  it("decides every label on a line the claim cites, whose text is at that line at the pin", () => {
    for (const c of DATA.claims) {
      const refs = c.evidence.map((e) => parseEvidenceRef(e)!);
      for (const r of refs) {
        expect(r, `${c.id} ${JSON.stringify(c.evidence)}`).not.toBeNull();
        const file = lines[r.path];
        expect(file, `${c.id}: ${r.path} is not a pinned file`).toBeDefined();
        expect(r.to, `${c.id}: ${r.path} ends at line ${file!.length}`).toBeLessThanOrEqual(
          file!.length,
        );
      }
      expect(c.decides.length, c.id).toBeGreaterThan(0);
      for (const d of c.decides) {
        const at = parseEvidenceRef(d.at)!;
        expect(lines[at.path]?.[at.from - 1], `${c.id} ${d.at}`).toContain(d.text);
        const cited = refs.some((r) => r.path === at.path && r.from <= at.from && at.from <= r.to);
        expect(cited, `${c.id}: ${d.at} is outside the claim's evidence`).toBe(true);
      }
    }
  });

  it("covers the three subtle shapes the brief names", () => {
    const shapes = DATA.claims.filter((c) => c.label === "refuted").map((c) => c.shape);
    expect(shapes.filter((s) => s === "dropped condition").length).toBeGreaterThanOrEqual(3);
    expect(shapes.filter((s) => s === "wrong default").length).toBeGreaterThanOrEqual(3);
    expect(shapes.filter((s) => /wrong (event|hook|list)/.test(s)).length).toBeGreaterThanOrEqual(
      3,
    );
  });
});

// Every label a call can settle is settled by calling the pinned code, not by reading it.
// r32's first wording ("a kind that has no pipeline throws") was keyed untested and is false
// for number, boolean and file; the review before the run caught it, and this would have.
describe("the pinned code agrees with the key", () => {
  const load = async () => {
    const d = mkdtempSync(join(tmpdir(), "refute-pin-"));
    for (const name of ["arms", "ledger", "score"]) {
      writeFileSync(join(d, `${name}.mjs`), pinned(`scripts/model-bakeoff/lib/${name}.mjs`));
    }
    return {
      arms: await import(join(d, "arms.mjs")),
      ledger: await import(join(d, "ledger.mjs")),
      score: await import(join(d, "score.mjs")),
    };
  };
  const label = (id: string) => DATA.claims.find((c) => c.id === id)!.label;

  it("settles r01, r10, r17, r31 (ledger), r13, r21, r28, r35 (arms), r18, r26, r32 (score)", async () => {
    const { arms, ledger, score } = await load();
    const line = (id: string, usage: object, effort?: string) =>
      JSON.stringify({ ...(effort ? { effort } : {}), message: { id, role: "assistant", usage } });
    const recs = ledger.usageRecords([
      line("m", { input_tokens: 1 }, "low"),
      line("m", { input_tokens: 2 }, "low"),
      line("n", { input_tokens: 3 }),
    ]).records;
    // r01: the last line of a repeated message.id is kept, not the first.
    expect(recs.find((r: { id: string }) => r.id === "m").usage.in).toBe(2);
    expect(label("r01")).toBe("refuted");
    // r31: a usage line with an id and no effort is recorded as (unset).
    expect(recs.find((r: { id: string }) => r.id === "n").effort).toBe("(unset)");
    expect(label("r31")).toBe("confirmed");
    // r10: cache reads count toward Haiku's 100K threshold.
    const u = { in: 10, out: 0, cr: 100000, cw: 0, cw5m: 0, cw1h: 0 };
    expect(ledger.priceRequest("claude-haiku-5-5", u).longPrompt).toBe(true);
    expect(label("r10")).toBe("refuted");
    // r17: an unsplit cache write is counted at the 5-minute rate.
    const unsplit = ledger.usageRecords([line("w", { cache_creation_input_tokens: 7 })]).records;
    expect(unsplit[0].usage).toMatchObject({ cw5m: 7, cw1h: 0 });
    expect(label("r17")).toBe("confirmed");
    // r13: a leading hyphen is refused. r21: null and "" are "no effort".
    expect(arms.validateArm({ id: "-a", model: "m", effort: "low" })[0]).toMatch(/must match/);
    expect(label("r13")).toBe("refuted");
    for (const effort of [null, ""]) {
      expect(arms.validateArm({ id: "a", model: "m", effort })[0]).toMatch(/has no effort/);
    }
    expect(label("r21")).toBe("refuted");
    // r28: gold and referee* are reserved. r35: readOnlyRules forbids gh.
    expect(arms.validateArms([{ id: "gold", model: "m", effort: "low" }])).not.toEqual([]);
    expect(arms.validateArms([{ id: "referee-x", model: "m", effort: "low" }])).not.toEqual([]);
    expect(label("r28")).toBe("confirmed");
    expect(arms.readOnlyRules("/d", "/w")).toContain("Do not run gh,");
    expect(label("r35")).toBe("refuted");
    // r18, r26: no hex, no plus. r32: "date" throws.
    expect(score.normalise("0x10", "number")).toBe("NaN:0x10");
    expect(label("r18")).toBe("refuted");
    expect(score.normalise("+5", "number")).not.toBe("5");
    expect(label("r26")).toBe("refuted");
    expect(() => score.normalise("x", "date")).toThrow(/unknown kind/);
    expect(label("r32")).toBe("untested");
    // r05, r11: string keeps punctuation; name drops a title followed by whitespace.
    expect(score.normalise("a.b", "string")).toBe("a.b");
    expect(label("r05")).toBe("refuted");
    expect(score.normalise("Dr. Who", "name")).toBe("who");
    expect(label("r11")).toBe("confirmed");
  });
});

describe("what the arms are given", () => {
  const dir = "/run/input";

  it("is the production skeptic prompt and per-kind schema, one item per claim", () => {
    const items = task.items(dir);
    const claims = task.claims();
    expect(items.map((i) => i.id)).toEqual(DATA.claims.map((c) => c.id));
    items.forEach((item, i) => {
      const c = claims[i]!;
      expect(item.prompt).toBe(refutePrompt(c, dir));
      expect(item.schema).toEqual(verdictSchema(c.kind));
    });
  });

  it("never names a label, the key or the run's truth", () => {
    const text = [
      ...task.items(dir).map((i) => i.prompt),
      task.prompt(dir),
      JSON.stringify(task.claims()),
    ].join("\n");
    for (const s of [...task.secrets, "label", "decides", "shape"]) expect(text).not.toContain(s);
  });

  it("copies exactly the pinned files into the frozen input", () => {
    const names = task.sources.flatMap((s) =>
      execFileSync("git", ["ls-tree", "--name-only", `${DATA.pin}:${s.from}`], {
        cwd: REPO,
        encoding: "utf8",
      })
        .split("\n")
        .filter((n) => s.match.test(n))
        .map((n) => `${s.to}/${n}`),
    );
    expect(names.sort()).toEqual(Object.keys(DATA.files).sort());
  });

  it("builds workflow args that carry the items, and refuses an id the marker cannot carry", () => {
    const args = extractArgs(task, dir) as { items: { id: string }[] };
    expect(args.items.map((i) => i.id)).toEqual(DATA.claims.map((c) => c.id));
    const bad = { ...task, items: () => [{ id: "R01", prompt: "p", schema: {} }] };
    expect(() => extractArgs(bad, dir)).toThrow(/item ids must match/);
  });
});

describe("truth refuses any bytes but the pin's", () => {
  const frozen = () => {
    const d = mkdtempSync(join(tmpdir(), "refute-input-"));
    for (const [to, f] of Object.entries(DATA.files)) {
      mkdirSync(dirname(join(d, to)), { recursive: true });
      writeFileSync(join(d, to), pinned(f.from));
    }
    return d;
  };

  it("passes the pinned copy and fails a one-byte change", () => {
    const d = frozen();
    expect(task.truth(d)).toEqual(task.labels());
    writeFileSync(join(d, "workflows/ci.yml"), pinned(".github/workflows/ci.yml") + " ");
    expect(() => task.truth(d)).toThrow(/workflows\/ci\.yml/);
  });
});

// The scorer is proved before any arm runs: the truth against itself is perfect, and a copy
// with three verdicts changed fails exactly those three, in the harness's checks and in the
// decision rule alike.
describe("the scorer", () => {
  const truth = task.labels();
  const flip = { r01: "confirmed", r02: "refuted", r07: "refuted" } as Record<string, string>;
  const perturbed = {
    verdicts: truth.verdicts.map((v) => ({ ...v, verdict: flip[v.id] ?? v.verdict })),
  };

  it("scores the truth against itself as perfect", () => {
    expect(scoreRun(task, truth, truth).filter((c) => !c.ok)).toEqual([]);
    const t = task.tally(truth);
    expect(t).toEqual({ misses: [], wrongKills: [], unconfirmed: [], behaviour: [], errors: [] });
    expect(task.passes(t)).toBe(true);
  });

  it("fails a perturbed copy exactly where it was changed", () => {
    const bad = scoreRun(task, truth, perturbed).filter((c) => !c.ok);
    expect(bad.map((c) => c.check).sort()).toEqual([
      "verdicts r01 / verdict",
      "verdicts r02 / verdict",
      "verdicts r07 / verdict",
    ]);
    expect(task.tally(perturbed)).toEqual({
      misses: ["r01"],
      wrongKills: ["r02", "r07"],
      unconfirmed: ["r02"],
      behaviour: ["r07"],
      errors: ["r01", "r02", "r07"],
    });
  });

  it("counts a claim with no verdict as an error, and a missed false claim as a miss", () => {
    const t = task.tally({ verdicts: truth.verdicts.filter((v) => v.id !== "r03") });
    expect(t.errors).toEqual(["r03"]);
    expect(t.misses).toEqual(["r03"]);
    expect(task.tally(null).errors).toHaveLength(DATA.claims.length);
  });
});

describe("assemble records verdicts as production does", () => {
  const dir = "/run/input";
  const quoted = (id: string, verdict: string, src: string) => ({
    id,
    verdict,
    reason: "r",
    quote: "q",
    quoteSource: src,
    evidenceRead: [],
    readFailed: [],
    restsOnAbsence: false,
  });

  it("downgrades an unquoted or off-evidence confirmation to unclear", () => {
    const out = task.assemble(
      {
        r02: quoted("r02", "confirmed", `${dir}/workflows/ci.yml:13`),
        r04: { ...quoted("r04", "confirmed", "workflows/fleet-nightly.yml:43"), quote: "" },
        r06: quoted("r06", "confirmed", `${dir}/bakeoff/score.mjs:2`),
      },
      dir,
    );
    expect(out.verdicts.map((v) => [v.id, v.verdict, v.downgraded])).toEqual([
      ["r02", "confirmed", false],
      ["r04", "unclear", true],
      ["r06", "unclear", true],
    ]);
  });

  it("rewrites a behaviour claim's confirmation to untested", () => {
    const out = task.assemble({ r07: quoted("r07", "confirmed", "workflows/ci.yml:98") }, dir);
    expect(out.verdicts).toEqual([
      { id: "r07", verdict: "untested", raw: "confirmed", downgraded: true },
    ]);
  });

  it("gives a claim no verdict when its skeptic typed another id, as production files it", () => {
    const out = task.assemble(
      {
        r01: quoted("r1", "refuted", "bakeoff/ledger.mjs:78"),
        r07: quoted("R07", "untested", "workflows/ci.yml:98"),
      },
      dir,
    );
    expect(out.verdicts).toEqual([]);
    expect(task.tally(out).errors).toContain("r01");
  });
});

describe("the decision rule", () => {
  const truth = task.labels();
  const run = (
    id: string,
    model: string,
    effort: string,
    changes: Record<string, string> = {},
  ) => ({
    id,
    model,
    effort,
    cost: 1,
    output: {
      verdicts: truth.verdicts.map((v) => ({ ...v, verdict: changes[v.id] ?? v.verdict })),
    },
  });
  // r01, r03, r05 are false; r02, r04, r06 true documentary; r07 is an untested behaviour claim.
  const prod = [run("gold", "opus", "xhigh"), run("opus-xhigh-2", "opus", "xhigh")];

  it("passes a run at each limit and fails it one past", () => {
    const at = (c: Record<string, string>) => task.passes(task.tally(run("x", "m", "e", c).output));
    expect(at({ r01: "unclear" })).toBe(true);
    expect(at({ r01: "unclear", r03: "confirmed" })).toBe(false);
    expect(at({ r02: "refuted" })).toBe(true);
    expect(at({ r02: "refuted", r04: "refuted" })).toBe(false);
    expect(at({ r02: "unclear", r04: "unclear" })).toBe(true);
    expect(at({ r02: "unclear", r04: "unclear", r06: "unclear" })).toBe(false);
    expect(at({ r07: "refuted" })).toBe(false);
  });

  it("qualifies a config within production's errors plus 2 and misses plus 1, both runs passing", () => {
    const spread = [
      run("haiku-1", "haiku", "medium", { r01: "x", r03: "x" }),
      run("haiku-2", "haiku", "medium", { r05: "x" }),
    ];
    const d = task.decide([
      ...prod,
      run("s-1", "sonnet", "high", { r01: "unclear", r02: "unclear" }),
      run("s-2", "sonnet", "high"),
      run("l-1", "opus", "low", { r01: "unclear" }),
      run("l-2", "opus", "low", { r03: "unclear" }),
      ...spread,
    ]);
    const by = Object.fromEntries(d.ranked.map((c) => [c.config, c]));
    expect(by["sonnet @ high"]).toMatchObject({
      errors: 2,
      misses: 1,
      allPass: true,
      qualifies: true,
    });
    expect(by["opus @ low"]).toMatchObject({
      errors: 2,
      misses: 2,
      allPass: true,
      qualifies: false,
    });
    expect(by["haiku @ medium"]).toMatchObject({ allPass: false, qualifies: false });
    expect(d.ranked.map((c) => c.config)).toEqual([
      "opus @ xhigh",
      "sonnet @ high",
      "opus @ low",
      "haiku @ medium",
    ]);
    expect(d).toMatchObject({ spread: 3, canRank: true, reasons: [] });
  });

  it("refuses to rank when production fails, the key is disputed, or the arms saturate", () => {
    const h = (c1: Record<string, string>, c2: Record<string, string> = {}) => [
      run("h-1", "haiku", "medium", c1),
      run("h-2", "haiku", "medium", c2),
    ];
    expect(task.decide(prod).reasons).toEqual(["saturated: pooled errors spread by 0"]);
    const failing = [
      run("gold", "opus", "xhigh", { r01: "x", r03: "x" }),
      run("opus-xhigh-2", "opus", "xhigh"),
      ...h({ r01: "x", r03: "x", r05: "x" }, { r09: "x", r11: "x" }),
    ];
    expect(task.decide(failing).reasons).toEqual(["production did not pass both its runs"]);
    const spread = [...prod, ...h({ r01: "x", r03: "x", r05: "x" })];
    expect(task.decide(spread).canRank).toBe(true);
    const disputed = task.decide(spread, {
      referenceErrors: [{ check: "verdicts r10 / verdict" }],
    });
    expect(disputed.reasons).toEqual(["the referee refuted the key on verdicts r10 / verdict"]);
    expect(disputed.ranked.some((c) => c.qualifies)).toBe(false);
    expect(task.decide(spread, { unruled: 4 }).reasons).toEqual([
      "4 disagreements are still unruled by the referee",
    ]);
    expect(
      task.decide(spread, { blockers: ["the frozen input changed during the run"] }).reasons,
    ).toEqual(["the frozen input changed during the run"]);
    expect(task.decide(spread.slice(2)).reasons[0]).toBe("production (opus @ xhigh) did not run");
  });

  it("leaves a config short of two runs, or with a faulted run, out of the spread", () => {
    const allWrong = Object.fromEntries(DATA.claims.map((c) => [c.id, "x"]));
    const perfect = [...prod, run("s-1", "sonnet", "high"), run("s-2", "sonnet", "high")];
    const crashed = task.decide([
      ...perfect,
      run("h-1", "haiku", "medium"),
      { ...run("h-2", "haiku", "medium", allWrong), invalid: true },
    ]);
    expect(crashed).toMatchObject({ spread: 0, canRank: false });
    expect(crashed.ranked.some((c) => c.qualifies)).toBe(false);
    const lone = task.decide([...perfect, run("h-1", "haiku", "medium", allWrong)]);
    expect(lone).toMatchObject({ spread: 0, canRank: false });
    const hLone = lone.ranked.find((c) => c.config === "haiku @ medium")!;
    expect(hLone).toMatchObject({
      complete: false,
      valid: false,
      allPass: false,
      qualifies: false,
    });
    expect(crashed.perRun.find((r) => r.id === "h-2")).toMatchObject({
      invalid: true,
      pass: false,
    });
    expect(task.decide([prod[0]!, ...perfect.slice(2)]).reasons[0]).toBe(
      "production has 1 valid-or-not runs, not 2",
    );
  });

  // #1493: the rule counts against the key, as pre-registered; the score column applies the
  // referee's rulings. The decision names every check where the two part.
  it("names each check a ruling credited against the key, which the rule still counts", () => {
    const runs = [
      ...prod,
      run("s-1", "sonnet", "high", { r02: "unclear" }),
      run("s-2", "sonnet", "high"),
    ];
    const records = Object.fromEntries(runs.map((r) => [r.id, { structured: r.output, cost: 1 }]));
    const arms = runs.map(({ id, model, effort }) => ({ id, model, effort }));
    const checksByArm = Object.fromEntries(
      runs.map((r) => [r.id, scoreRun(task, truth, r.output)]),
    );
    const c = checksByArm["s-1"]!.find((x) => x.check === "verdicts r02 / verdict")!;
    const ruled = { [disagreementId(c)]: { armCorrect: true, refCorrect: true, note: "n" } };
    const d = task.decision(records, "/d", { arms, checksByArm, rulings: ruled });
    expect(d.rulingChanges).toEqual([
      { run: "s-1", check: "verdicts r02 / verdict", got: "unclear", key: "confirmed" },
    ]);
    expect(d.perRun.find((r) => r.id === "s-1")!.errors).toEqual(["r02"]);
    expect(d.lines).toContain(
      "Referee rulings this rule does not apply (it counts against the key; the score column credits these): s-1 verdicts r02 / verdict (gave unclear, key confirmed).",
    );
    // A ruling that upholds the key changes nothing; no rulings at all reads the same.
    const upheld = { [disagreementId(c)]: { armCorrect: false, refCorrect: true, note: "n" } };
    for (const rulings of [upheld, {}]) {
      expect(task.decision(records, "/d", { arms, checksByArm, rulings }).lines).toContain(
        "Referee rulings this rule does not apply (it counts against the key; the score column credits these): none.",
      );
    }
  });

  it("lists only checks the score column credits, not one it drops with a refuted item", () => {
    // a-1 leaves r02 out, and a ruling refutes the key's r02 item (it is not a claim), so the
    // score column drops b-1's r02 verdict check rather than crediting it.
    const a = { verdicts: truth.verdicts.filter((v) => v.id !== "r02") };
    const b = run("b-1", "x", "y", { r02: "unclear" }).output;
    const checksByArm = { "a-1": scoreRun(task, truth, a), "b-1": scoreRun(task, truth, b) };
    const pres = checksByArm["a-1"].find((c) => c.check === "verdicts r02 / (present)")!;
    const verd = checksByArm["b-1"].find((c) => c.check === "verdicts r02 / verdict")!;
    const rulings = {
      [disagreementId(pres)]: { armCorrect: true, refCorrect: false, note: "not a claim" },
      [disagreementId(verd)]: { armCorrect: true, refCorrect: true, note: "unclear is fine" },
    };
    expect(task.rulingChanges(checksByArm, rulings)).toEqual([
      { run: "a-1", check: "verdicts r02 / (present)", got: "absent", key: "present" },
    ]);
  });

  it("prints a pooled cost with an unfinished request as a lower bound (#1435)", () => {
    const records = Object.fromEntries(
      prod.map((r, i) => [r.id, { structured: r.output, cost: 1, requests: 3, unfinished: i }]),
    );
    const arms = prod.map(({ id, model, effort }) => ({ id, model, effort }));
    const row = task
      .decision(records, "/d", { arms })
      .lines!.find((l) => l.startsWith("| opus @ xhigh"));
    expect(row).toMatch(/\| ≥\$2\.00 \(1 of 6 unfinished\) \|$/);
  });

  it("reads the run's own arms, so an --arms file is reported under the config it asked for", () => {
    const records = Object.fromEntries(
      [...prod, run("opus-medium-1", "sonnet", "low")].map((r) => [
        r.id,
        { structured: r.output, cost: r.cost },
      ]),
    );
    const arms = [
      { id: "gold", model: "opus", effort: "xhigh" },
      { id: "opus-xhigh-2", model: "opus", effort: "xhigh" },
      { id: "opus-medium-1", model: "sonnet", effort: "low" },
    ];
    const d = task.decision(records, "/d", { arms });
    expect(d.ranked.map((c) => c.config).sort()).toEqual(["opus @ xhigh", "sonnet @ low"]);
  });
});

// ---- the harness's fan-out ---------------------------------------------------------------

const user = (text: string) => JSON.stringify({ message: { role: "user", content: text } });
const assistant = (id: string, content: unknown[], effort: string, model: string, out = 2) =>
  JSON.stringify({
    effort,
    message: {
      id,
      model,
      role: "assistant",
      content,
      usage: { input_tokens: 1000, output_tokens: out },
    },
  });
const structured = (input: unknown) => ({
  type: "tool_use",
  id: "so",
  name: "StructuredOutput",
  input,
});

describe("the workflow's item mode", () => {
  const run = "/r";
  const args = { ...extractArgs(task, `${run}/input`, task.arms, `${run}/work`) };

  it("spawns one agent per arm and claim, each marked and in its own work dir", async () => {
    const { calls } = await runWorkflow({ ...args, only: ["gold", "haiku-medium-1"] });
    expect(calls).toHaveLength(2 * DATA.claims.length);
    const first = calls[0]!;
    expect(first.opts).toMatchObject({ model: "opus", effort: "xhigh", label: "gold:gold/r01" });
    const t = readAgentTranscript(user(first.prompt));
    expect(t.marker).toEqual({ kind: "arm", id: "gold", item: "r01" });
    expect(first.prompt).toContain(`${expectedWork(args as never, t.marker!)}.`);
    expect(expectedWork(args as never, t.marker!)).toBe("/r/work/gold/r01");
    const haiku = calls.find((c) => c.opts.label === "arm:haiku-medium-1/r07")!;
    expect(haiku.opts).toMatchObject({ model: "haiku", effort: "medium" });
    expect(haiku.opts.schema).toEqual(verdictSchema("behavior"));
    expect(haiku.prompt.startsWith(task.items(`${run}/input`)[6]!.prompt)).toBe(true);
  });

  it("refuses an `only` that names no arm of the run, before any agent", async () => {
    const { result, calls } = await runWorkflow({ ...args, only: ["gold", "nobody"] });
    expect(result.error).toMatch(/args\.only/);
    expect(calls).toEqual([]);
  });

  it("still runs a whole-task run as one agent per arm", async () => {
    const { items: _items, ...whole } = args as Record<string, unknown>;
    const { calls } = await runWorkflow(whole);
    expect(calls).toHaveLength(1 + task.arms.length);
    expect(readAgentTranscript(user(calls[1]!.prompt)).marker).toEqual({
      kind: "arm",
      id: "opus-xhigh-2",
    });
  });
});

describe("collecting and combining an item run", () => {
  const H = { id: "h", model: "haiku", effort: "medium" };
  const ARGS = {
    dir: "/r/input",
    work: "/r/work",
    gold: { id: "gold", model: "opus", effort: "xhigh" },
    arms: [H],
    items: [{ id: "r01" }, { id: "r02" }],
  };
  const transcript = (
    arm: string,
    item: string,
    out: unknown,
    extra: { effort?: string; marker?: string; file?: string } = {},
  ) =>
    ({
      ...readAgentTranscript(
        [
          user(
            `claim\nYour own scratch directory is /r/work/${arm}/${item}. In /r/input.\n\n(${extra.marker ?? `BAKEOFF-ARM: ${arm} ITEM: ${item}`})`,
          ),
          assistant(
            `${arm}-${item}`,
            [structured(out)],
            extra.effort ?? "medium",
            "claude-haiku-5-5",
            2000,
          ),
        ].join("\n"),
      ),
      transcript: extra.file ?? `/t/${arm}-${item}.jsonl`,
      agentType: "bakeoff-readonly",
    }) as Collected;

  it("keys each transcript by arm and item, and refuses a stray or missing item", () => {
    const { agents, errors } = mergeAgents(
      {},
      [
        transcript("h", "r01", {}),
        transcript("h", "r09", {}),
        transcript("h", "r02", {}, { marker: "BAKEOFF-ARM: h" }),
      ],
      ARGS,
    );
    expect(Object.keys(agents)).toEqual(["h/r01"]);
    expect(errors).toEqual([
      "/t/h-r09.jsonl: marker h/r09 names no item of this run",
      "/t/h-r02.jsonl: marker h names no item of this run",
    ]);
    const { items: _items, ...plain } = ARGS;
    expect(mergeAgents({}, [transcript("h", "r01", {})], plain).errors).toEqual([
      "/t/h-r01.jsonl: marker h/r01 names an item, and this run has none",
    ]);
  });

  it("sums cost and requests over the items, checks each, and reports a missing one", () => {
    const { agents } = mergeAgents({}, [transcript("h", "r01", { verdict: "refuted" })], ARGS);
    const fake = { assemble: (o: Record<string, unknown>) => ({ got: Object.keys(o) }) };
    const one = combineItems(fake, ARGS, agents, H);
    expect(one.problems).toEqual(["h/r02: no transcript found"]);
    expect(one.record).toMatchObject({ requests: 1, structured: { got: ["r01"] } });
    const both = mergeAgents(agents, [transcript("h", "r02", {}, { effort: "high" })], ARGS);
    const two = combineItems(fake, ARGS, both.agents, H);
    expect(two.problems).toEqual(["h/r02: asked for effort medium, transcripts show high"]);
    expect(two.record!.requests).toBe(2);
    expect(two.record!.efforts).toEqual(["high", "medium"]);
    expect(two.record!.cost).toBeCloseTo(2 * one.record!.cost!, 10);
    // Neither item transcript has a final usage line, so both requests are lower bounds (#1435).
    expect(two.record!.unfinished).toBe(2);
    expect(combineItems(fake, ARGS, {}, H).record).toBeNull();
    const silent = mergeAgents({}, [transcript("h", "r01", null)], ARGS).agents;
    expect(combineItems(fake, ARGS, silent, H).record!.structured).toBeNull();
  });

  it("explains a lower bound under the table only when a priced cost is one (#1435)", () => {
    const arm = {
      id: "h",
      asked: "haiku @ low",
      ran: "x",
      score: "1/1",
      requests: 3,
      longPrompt: 0,
    };
    const result = (a: Record<string, unknown>) => ({
      reference: "script truth",
      disagreements: 0,
      unruled: 0,
      problems: [],
      arms: [{ ...arm, ...a }],
    });
    const priced = formatResult(result({ cost: 1, unfinished: 2 }));
    expect(priced).toContain("| ≥$1.00 (2 of 3 unfinished) |");
    expect(priced).toMatch(/^≥: a lower bound/m);
    expect(formatResult(result({ cost: null, unfinished: 2 }))).not.toMatch(/≥/);
  });

  it("names any agent that read or grepped for the answer key", () => {
    const agents = {
      "h/r01": { bash: ["cat /r/input/bakeoff/arms.mjs"], reads: [] },
      "h/r02": { bash: [], reads: [JSON.stringify({ file_path: "/r/truth.json" })] },
      "gold/r01": { bash: ["grep -rn r01 scripts/model-bakeoff/tasks/refute-repo.data.json"] },
      "gold/r02": { bash: ["sed -n '58,87p' /tmp/refute-repo-1/input/bakeoff/ledger.mjs"] },
    };
    expect(secretReads(task.secrets, agents)).toEqual([
      "h/r02: read or ran a command naming truth.json",
      "gold/r01: read or ran a command naming refute-repo.data.json",
    ]);
  });

  it("records Read, Grep and Glob inputs as reads", () => {
    const t = readAgentTranscript(
      [
        user("x\n\n(BAKEOFF-ARM: h ITEM: r01)"),
        assistant(
          "m",
          [{ type: "tool_use", name: "Read", input: { file_path: "/r/truth.json" } }],
          "medium",
          "claude-haiku-5-5",
        ),
      ].join("\n"),
    );
    expect(t.reads).toEqual(['{"file_path":"/r/truth.json"}']);
  });
});

describe("split", () => {
  it("writes one self-contained launcher per arm that runs only that arm", async () => {
    const args = extractArgs(task, "/r/input", task.arms, "/r/work") as Parameters<
      typeof launchers
    >[0];
    const ls = launchers(args, readFileSync(WORKFLOW, "utf8"));
    expect(ls.map((l) => l.id)).toEqual(["gold", ...task.arms.map((a) => a.id)]);
    const l = ls[1]!;
    expect(l.script).toMatch(
      /^export const meta = \{\n {2}name: "bakeoff-refute-repo-opus-xhigh-2",/,
    );
    expect(l.script.match(/export const meta/g)).toHaveLength(1);
    const calls: Record<string, unknown>[] = [];
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const body = new AsyncFunction(
      "agent",
      "parallel",
      "phase",
      "log",
      l.script.replace(/^export const meta/m, "const meta"),
    );
    await body(
      async (_p: string, opts: Record<string, unknown>) => {
        calls.push(opts);
        return {};
      },
      (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t())),
      () => {},
      () => {},
    );
    expect(calls).toHaveLength(DATA.claims.length);
    expect(
      calls.every(
        (c) => c.model === "opus" && c.effort === "xhigh" && c.agentType === "bakeoff-readonly",
      ),
    ).toBe(true);
    expect(() => launchers(args, "no meta here")).toThrow(/meta/);
  });
});

// `score` end to end on an item run: a frozen input of the pinned files, two runs of
// production and a perfect copy of the key as their verdicts. A brace-less `if` once pushed
// "the frozen input changed" on every score; only a run through the CLI shows that.
describe("score on an item run", () => {
  const CLI = join(REPO, "scripts/model-bakeoff/bakeoff.mjs");
  const build = () => {
    const run = mkdtempSync(join(tmpdir(), "rr-score-"));
    const input = join(run, "input");
    for (const [to, f] of Object.entries(DATA.files)) {
      mkdirSync(dirname(join(input, to)), { recursive: true });
      writeFileSync(join(input, to), pinned(f.from));
    }
    const arm = { id: "opus-xhigh-2", model: "opus", effort: "xhigh" };
    const args = extractArgs(task, input, [arm], join(run, "work"));
    const runs: Record<string, unknown> = {};
    for (const id of ["gold", arm.id]) {
      for (const c of DATA.claims) {
        runs[`${id}/${c.id}`] = {
          transcript: `/t/${id}-${c.id}.jsonl`,
          marker: { kind: "arm", id, item: c.id },
          markerError: null,
          structured: {
            id: c.id,
            verdict: c.label,
            quote: "q",
            quoteSource: c.decides[0]!.at,
          },
          models: ["claude-opus-5-5"],
          efforts: ["xhigh"],
          requests: 1,
          repeats: 0,
          cost: 0.01,
          longPrompt: 0,
          bash: [],
          writes: [],
          reads: [],
          otherTools: [],
          forbidden: [],
          prompt: "",
          agentType: "bakeoff-readonly",
        };
      }
    }
    writeFileSync(join(run, "manifest.json"), JSON.stringify(manifest(input)));
    writeFileSync(truthPath(run), JSON.stringify(task.truth(input)));
    writeFileSync(join(run, "workflow-args.json"), JSON.stringify(args));
    writeFileSync(runsPath(run), JSON.stringify(runs));
    return run;
  };
  const score = (run: string) => {
    try {
      execFileSync(process.execPath, [CLI, "score", "--run", run], { encoding: "utf8" });
    } catch {
      // A saturated or incomplete run exits 1; the result file is what is checked.
    }
    return JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
  };

  it("scores a clean run without inventing a problem, and finds a changed input", () => {
    const run = build();
    const clean = score(run);
    expect(clean.problems).toEqual([]);
    expect(clean.arms.map((a: { score: string }) => a.score)).toEqual(["73/73", "73/73"]);
    expect(clean.decision.reasons).toEqual(["saturated: pooled errors spread by 0"]);
    const m = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
    m["workflows/ci.yml"] = "444:0";
    writeFileSync(join(run, "manifest.json"), JSON.stringify(m));
    const changed = score(run);
    expect(changed.problems).toContain("the frozen input changed during the run");
    expect(changed.decision.reasons).toContain("the frozen input changed during the run");
  });

  it("faults an item agent or a referee that did not run as the read-only type", () => {
    const run = build();
    const runs = JSON.parse(readFileSync(runsPath(run), "utf8"));
    runs["opus-xhigh-2/r01"].agentType = "workflow-subagent";
    delete runs["gold/r02"].agentType;
    runs["referee:r1-1"] = {
      ...runs["gold/r01"],
      transcript: "/t/referee.jsonl",
      marker: { kind: "referee", id: "r1-1" },
      efforts: ["high"],
      structured: { rulings: [] },
      agentType: "workflow-subagent",
    };
    writeFileSync(runsPath(run), JSON.stringify(runs));
    const r = score(run);
    expect(r.problems).toEqual([
      "gold/r02: no agent type in runs.json, which predates the agent-type check; collect again to read it from the .meta.json (a run launched before 2026-10-20 then shows as the default agent and must be launched again)",
      "opus-xhigh-2/r01: ran as agent type workflow-subagent, not bakeoff-readonly",
      "referee:r1-1: ran as agent type workflow-subagent, not bakeoff-readonly",
    ]);
    // A referee's fault blocks the ranking; an arm's marks that run invalid.
    expect(r.decision.reasons).toContain(
      "referee:r1-1: ran as agent type workflow-subagent, not bakeoff-readonly",
    );
    const invalid = (id: string) =>
      r.decision.perRun.find((p: { id: string }) => p.id === id).invalid;
    expect([invalid("gold"), invalid("opus-xhigh-2")]).toEqual([true, true]);
  });

  it("hands the referee's rulings to the decision, which names the check a ruling credited", () => {
    const run = build();
    const runs = JSON.parse(readFileSync(runsPath(run), "utf8"));
    const c = DATA.claims.find((x) => x.label === "confirmed")!;
    runs[`opus-xhigh-2/${c.id}`].structured.verdict = "unclear";
    const id = `verdicts ${c.id} / verdict :: unclear`;
    runs["referee:r1-1"] = {
      ...runs["gold/r01"],
      transcript: "/t/referee.jsonl",
      marker: { kind: "referee", id: "r1-1" },
      efforts: ["high"],
      structured: { rulings: [{ id, armCorrect: true, refCorrect: true, note: "n" }] },
    };
    writeFileSync(runsPath(run), JSON.stringify(runs));
    const r = score(run);
    expect(r.arms.find((a: { id: string }) => a.id === "opus-xhigh-2").score).toBe("73/73");
    expect(r.decision.rulingChanges).toEqual([
      {
        run: "opus-xhigh-2",
        check: `verdicts ${c.id} / verdict`,
        got: "unclear",
        key: "confirmed",
      },
    ]);
  });

  it("refuses a run whose truth is still inside it, as runs prepared before #1492 kept it", () => {
    const run = build();
    renameSync(truthPath(run), join(run, "truth.json"));
    let err = "";
    try {
      execFileSync(process.execPath, [CLI, "score", "--run", run], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      err = String((e as { stderr: string }).stderr);
    }
    expect(err).toContain(
      `no truth at ${truthPath(run)}; this run keeps it at ${join(run, "truth.json")}, where its arms could read it (#1492). Move it to ${truthPath(run)} to score.`,
    );
  });

  it("writes an unruled disagreement's referee args beside the run, not inside it (#1540)", () => {
    const run = build();
    const runs = JSON.parse(readFileSync(runsPath(run), "utf8"));
    const c = DATA.claims.find((x) => x.label === "confirmed")!;
    runs[`opus-xhigh-2/${c.id}`].structured.verdict = "unclear";
    writeFileSync(runsPath(run), JSON.stringify(runs));
    const r = score(run);
    expect(r.unruled).toBe(1);
    const args = JSON.parse(readFileSync(refereeArgsPath(run), "utf8"));
    expect(args.chunks[0][0].REFERENCE).toBe("confirmed");
    expect(readdirSync(run).filter((f) => /runs|referee/.test(f))).toEqual([]);
  });

  it("refuses to score a run whose runs.json is still inside it (#1540)", () => {
    const run = build();
    renameSync(runsPath(run), join(run, "runs.json"));
    let err = "";
    try {
      execFileSync(process.execPath, [CLI, "score", "--run", run], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      err = String((e as { stderr: string }).stderr);
    }
    expect(err).toContain(
      `${join(run, "runs.json")} is inside the run, where its arms could read it (#1540). Move it to ${runsPath(run)} first.`,
    );
  });

  it("stops the ranking when the referee ran on the wrong model or broke a rule", () => {
    const run = build();
    const runs = JSON.parse(readFileSync(runsPath(run), "utf8"));
    runs["referee:r1-1"] = {
      ...runs["gold/r01"],
      transcript: "/t/referee.jsonl",
      marker: { kind: "referee", id: "r1-1" },
      models: ["claude-haiku-5-5"],
      efforts: ["low"],
      structured: { rulings: [] },
      writes: ["/etc/passwd"],
    };
    writeFileSync(runsPath(run), JSON.stringify(runs));
    const r = score(run);
    const why = r.decision.reasons.join("\n");
    expect(why).toMatch(
      /referee:r1-1: asked for claude-opus-5-5, transcripts show claude-haiku-5-5/,
    );
    expect(why).toMatch(/referee:r1-1: wrote outside/);
    expect(r.decision.canRank).toBe(false);
  });
});
