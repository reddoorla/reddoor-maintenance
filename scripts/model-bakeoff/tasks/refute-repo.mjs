import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCost } from "../lib/ledger.mjs";
import { finalScores } from "../lib/score.mjs";
import {
  enforceQuoteRule,
  refutePrompt,
  validateClaims,
  verdictSchema,
} from "../../meta-week/lib/refute-claims.mjs";

export const id = "refute-repo";
export const title =
  "T5 refute-claims skeptics, one per claim, on 36 claims about pinned repo files";
export const row = 5;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The claims, their labels and the pinned evidence. It is read from the repo and never copied
// into the frozen input, and `score` reports any agent that names it (see `secrets`).
export const DATA_FILE = "scripts/model-bakeoff/tasks/refute-repo.data.json";
export const DATA = JSON.parse(readFileSync(join(REPO, DATA_FILE), "utf8"));

// The evidence is six repo files at one commit of main, not third-party docs: P1-57's control
// cited a fetched docs corpus that had drifted on 39 of 40 pages. Materialise the pin and
// prepare from it, so `prepare` copies the pinned bytes and not today's:
//
//   git worktree add --detach <scratch>/pin <DATA.pin>
//   node scripts/model-bakeoff/bakeoff.mjs prepare --task refute-repo --root <scratch>/pin --out <run>
//
// `truth` refuses any other bytes.
export const sources = Object.values(
  Object.entries(DATA.files).reduce((acc, [to, f]) => {
    const dest = dirname(to);
    const from = dirname(f.from);
    const s = (acc[dest] ??= { from, names: [], to: dest });
    if (s.from !== from) throw new Error(`${dest} gathers files from two directories`);
    s.names.push(f.from.slice(from.length + 1));
    return acc;
  }, {}),
).map(({ from, names, to }) => ({
  from,
  match: new RegExp(`^(${names.map((n) => n.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("|")})$`),
  to,
}));

// Any agent whose commands or reads name these has looked at the answer key.
// File names, not the task id: a run directory may well be called refute-repo-1, and every
// skeptic names its input folder.
export const secrets = ["refute-repo.data.json", "truth.json"];

/** The claims as the workflow validates them, labels stripped. */
export function claims(data = DATA) {
  const { claims: valid, errors } = validateClaims(
    data.claims.map((c) => ({
      id: c.id,
      claim: c.claim,
      ...(c.kind ? { kind: c.kind } : {}),
      evidence: c.evidence,
    })),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  return valid;
}

// One agent per claim, given the production skeptic prompt and the production per-kind verdict
// schema, word for word, as `.claude/workflows/refute-claims.workflow.js` spawns them.
export function items(dir) {
  return claims().map((c) => ({
    id: c.id,
    prompt: refutePrompt(c, dir),
    schema: verdictSchema(c.kind),
  }));
}

// What the referee is shown as "the task". It names every claim, never a label.
export function prompt(dir) {
  return [
    `A refuter round over ${DATA.claims.length} claims about the files in ${dir}. Each participant was one skeptic per claim, told to REFUTE it from the cited lines.`,
    'A documentary claim (no kind) takes "confirmed" only when a cited line says it, "refuted" when a cited line contradicts it, and "unclear" when the lines neither say nor contradict it. A behaviour claim asserts what the code DOES and takes only "refuted" (a cited line contradicts it) or "untested" (the lines are consistent with it). A confirmation without a verbatim quote from the claim\'s own evidence is recorded as "unclear".',
    "Claims:",
    ...claims().map(
      (c) =>
        `- ${c.id}${c.kind === "behavior" ? " [behaviour]" : ""}: ${c.claim} (evidence: ${c.evidence.join(", ")})`,
    ),
  ].join("\n");
}

export const goldAddendum = "";

// The scored shape, after `assemble`. The arms never see it: each item has its own schema.
export const schema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, verdict: { type: "string" } },
        required: ["id", "verdict"],
      },
    },
  },
  required: ["verdicts"],
};

export const collections = [
  { name: "verdicts", key: "id", keyKind: "string", fields: { verdict: "string" } },
];

/**
 * The arm's verdicts as production records them: each skeptic's output through the workflow's
 * own `enforceQuoteRule`. Production files a verdict under the id the skeptic typed
 * (`byId.get(r.id)`), so a skeptic that mistypes its claim's id leaves that claim with no
 * verdict here too, rather than being credited for an answer production would drop.
 */
export function assemble(outputs, dir) {
  return {
    verdicts: claims()
      .filter((c) => outputs[c.id] && outputs[c.id].id === c.id)
      .map((c) => {
        const out = outputs[c.id];
        const v = enforceQuoteRule(out, c, dir);
        return { id: c.id, verdict: v.verdict, raw: out.verdict, downgraded: v.downgraded };
      }),
  };
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function verifyFiles(dir, files = DATA.files) {
  const bad = Object.entries(files)
    .filter(([p, f]) => {
      try {
        return sha256(readFileSync(join(dir, p))) !== f.sha256;
      } catch {
        return true;
      }
    })
    .map(([p]) => p);
  if (bad.length) {
    throw new Error(
      `the frozen input is not the pinned evidence (${DATA.pin}): ${bad.join(", ")}. Prepare with --root at a checkout of the pin.`,
    );
  }
}

/** The key as the scored reference. */
export function labels(data = DATA) {
  return { verdicts: data.claims.map((c) => ({ id: c.id, verdict: c.label })) };
}

export function truth(dir) {
  verifyFiles(dir);
  return labels();
}

// ---- the decision rule, committed before the first run ---------------------------------
//
// Per run, against the key, on the verdicts as `assemble` records them:
// - misses: false claims (labelled "refuted") the run did not refute;
// - wrongKills: true claims (labelled "confirmed" or "untested") the run refuted;
// - unconfirmed: true documentary claims the run did not confirm;
// - errors: claims whose verdict is not the label, a claim with no verdict included.
//
// A run PASSES when misses <= 1, wrongKills <= 1, unconfirmed <= 2 and every "untested" label
// came back "untested". A config (model and effort) pools its two runs. It QUALIFIES to
// replace production (Opus at xhigh, the gold plus opus-xhigh-2) only if both its runs pass,
// its pooled errors are at most production's plus 2, and its pooled misses at most
// production's plus 1. Configs rank by pooled errors, then pooled misses, then cost.
//
// The control is only allowed to rank when it is proven on this run:
// - production passes both its runs (the known-good input passes);
// - the referee upheld every label it was asked about (a disputed label is a defect in the
//   control: fix the key and score again);
// - pooled errors spread by at least 3 across configs. Less is reported as saturated.
// - no disagreement is still waiting on the referee.
//
// A config without exactly RUNS_PER_CONFIG runs, or with a run `score` found a problem in
// (wrong model or effort, a missing item, a forbidden command), neither passes nor qualifies,
// and none qualifies while the control may not rank. Neither kind counts toward the spread: a
// run that crashed or returned nothing must not turn a saturated control into a ranking one.
// Any problem `score` finds that is not one arm's (the input changed, the referee contradicts
// itself, a referee's command or read named the key's file) is a `blocker`, and stops the
// ranking too.
//
// The rule counts against the key, but the score column applies the referee's rulings, so a
// ruling that credits a run (`armCorrect: true`) shows there as correct and here as an error.
// The rule stays as registered; `rulingChanges` names each such check in the report (#1493).

export const TOLERANCE = Object.freeze({
  misses: 1,
  wrongKills: 1,
  unconfirmed: 2,
  errorsOverProduction: 2,
  missesOverProduction: 1,
  minSpread: 3,
});

export const PRODUCTION = Object.freeze({ model: "opus", effort: "xhigh" });

export const RUNS_PER_CONFIG = 2;

export function tally(output, data = DATA) {
  const given = new Map();
  for (const v of (output && output.verdicts) || []) {
    if (v && !given.has(v.id)) given.set(v.id, v.verdict);
  }
  const t = { misses: [], wrongKills: [], unconfirmed: [], behaviour: [], errors: [] };
  for (const c of data.claims) {
    const got = given.has(c.id) ? given.get(c.id) : null;
    if (got !== c.label) t.errors.push(c.id);
    if (c.label === "refuted") {
      if (got !== "refuted") t.misses.push(c.id);
      continue;
    }
    if (got === "refuted") t.wrongKills.push(c.id);
    if (c.label === "confirmed" && got !== "confirmed") t.unconfirmed.push(c.id);
    if (c.label === "untested" && got !== "untested") t.behaviour.push(c.id);
  }
  return t;
}

/**
 * The checks a referee ruling credited although the key disagrees, per run: the score column
 * counts them correct, and this rule counts them against the key. They are read from the score
 * column's own `finalScores`, so a check it drops (a field of an item the referee refuted) is
 * not listed, and a ruling that upholds the key changes nothing. `checksByArm` is `score`'s,
 * before rulings.
 */
export function rulingChanges(checksByArm = {}, rulings = {}) {
  const { per } = finalScores(checksByArm, rulings);
  return Object.entries(per).flatMap(([run, p]) => p.credited.map((c) => ({ run, ...c })));
}

export function passes(t, tol = TOLERANCE) {
  return (
    t.misses.length <= tol.misses &&
    t.wrongKills.length <= tol.wrongKills &&
    t.unconfirmed.length <= tol.unconfirmed &&
    t.behaviour.length === 0
  );
}

const configOf = (arm) => `${arm.model} @ ${arm.effort}`;

/**
 * `runs` is `[{ id, model, effort, output, cost, invalid? }]`, one per run; `invalid` marks a
 * run `score` found a problem in. Returns each run's tally, each config's pooled numbers in rank
 * order, and whether this run may rank at all.
 */
export function decide(
  runs,
  { referenceErrors = [], unruled = 0, blockers = [] } = {},
  tol = TOLERANCE,
  data = DATA,
) {
  const perRun = runs.map((r) => {
    const t = tally(r.output, data);
    const invalid = Boolean(r.invalid);
    return {
      id: r.id,
      config: configOf(r),
      cost: r.cost,
      requests: r.requests,
      unfinished: r.unfinished,
      ...t,
      invalid,
      pass: !invalid && passes(t, tol),
    };
  });
  const configs = new Map();
  for (const r of perRun) {
    const c = configs.get(r.config) ?? {
      config: r.config,
      runs: [],
      errors: 0,
      misses: 0,
      cost: 0,
      requests: 0,
      unfinished: 0,
    };
    c.runs.push(r.id);
    c.errors += r.errors.length;
    c.misses += r.misses.length;
    c.cost = c.cost === null || r.cost === null ? null : c.cost + r.cost;
    c.requests += r.requests ?? 0;
    c.unfinished += r.unfinished ?? 0;
    c.allPass = (c.allPass ?? true) && r.pass;
    configs.set(r.config, c);
  }
  for (const c of configs.values()) {
    c.complete = c.runs.length === RUNS_PER_CONFIG;
    c.valid = c.complete && perRun.every((r) => r.config !== c.config || !r.invalid);
    c.allPass = c.allPass && c.complete;
  }
  const ranked = [...configs.values()].sort(
    (a, b) =>
      a.errors - b.errors || a.misses - b.misses || (a.cost ?? Infinity) - (b.cost ?? Infinity),
  );
  const prod = configs.get(configOf(PRODUCTION));
  const reasons = [];
  if (!prod) reasons.push("production (opus @ xhigh) did not run");
  else if (!prod.complete)
    reasons.push(`production has ${prod.runs.length} valid-or-not runs, not ${RUNS_PER_CONFIG}`);
  else if (!prod.allPass) reasons.push("production did not pass both its runs");
  if (unruled > 0) reasons.push(`${unruled} disagreements are still unruled by the referee`);
  if (referenceErrors.length) {
    reasons.push(
      `the referee refuted the key on ${referenceErrors.map((e) => e.check).join("; ")}`,
    );
  }
  for (const b of blockers) reasons.push(b);
  const counted = ranked.filter((c) => c.valid);
  const spread = counted.length ? counted[counted.length - 1].errors - counted[0].errors : 0;
  if (spread < tol.minSpread) reasons.push(`saturated: pooled errors spread by ${spread}`);
  const canRank = reasons.length === 0;
  for (const c of ranked) {
    c.qualifies =
      canRank &&
      Boolean(prod) &&
      c.allPass &&
      c.errors <= prod.errors + tol.errorsOverProduction &&
      c.misses <= prod.misses + tol.missesOverProduction;
  }
  return { perRun, ranked, spread, canRank, reasons };
}

/**
 * The `score` hook: the decision, and its lines for the report. `ctx.arms` is the run's own
 * gold and arms (an `--arms` file replaces the defaults), `ctx.invalid` the arm ids `score`
 * found a problem in.
 */
export function decision(records, dir, ctx = {}) {
  const {
    arms: runArms = [gold, ...arms],
    invalid = [],
    referenceErrors = [],
    unruled = 0,
    blockers = [],
    checksByArm = {},
    rulings = {},
  } = ctx;
  const runs = runArms
    .filter((a) => records[a.id])
    .map((a) => ({
      ...a,
      output: records[a.id].structured,
      cost: records[a.id].cost,
      requests: records[a.id].requests,
      unfinished: records[a.id].unfinished,
      invalid: invalid.includes(a.id),
    }));
  const d = decide(runs, { referenceErrors, unruled, blockers });
  d.rulingChanges = rulingChanges(checksByArm, rulings);
  const ids = (xs) => (xs.length ? xs.join(" ") : "none");
  const changed = d.rulingChanges.map((x) => `${x.run} ${x.check} (gave ${x.got}, key ${x.key})`);
  d.lines = [
    "| Config | Runs | Pooled errors | Pooled misses | Every run passes | Qualifies | Cost (all runs) |",
    "|---|---|---|---|---|---|---|",
    ...d.ranked.map(
      (c) =>
        `| ${c.config} | ${c.runs.join(", ")} | ${c.errors} | ${c.misses} | ${c.allPass ? "yes" : "no"} | ${c.qualifies ? "yes" : "no"} | ${formatCost(c.cost, c.unfinished, c.requests)} |`,
    ),
    "",
    "| Run | Misses (false not refuted) | Wrong kills (true refuted) | Unconfirmed true docs | Behaviour off | Problem | Pass |",
    "|---|---|---|---|---|---|---|",
    ...d.perRun.map(
      (r) =>
        `| ${r.id} | ${ids(r.misses)} | ${ids(r.wrongKills)} | ${ids(r.unconfirmed)} | ${ids(r.behaviour)} | ${r.invalid ? "yes" : "no"} | ${r.pass ? "yes" : "no"} |`,
    ),
    "",
    `Referee rulings this rule does not apply (it counts against the key; the score column credits these): ${changed.length ? changed.join("; ") : "none"}.`,
    d.canRank
      ? `The control ranks this run: production passed, the key held, and pooled errors spread by ${d.spread}.`
      : `The control may NOT rank this run: ${d.reasons.join("; ")}.`,
  ];
  return d;
}

export const arms = [
  { id: "opus-xhigh-2", model: "opus", effort: "xhigh" },
  { id: "opus-medium-1", model: "opus", effort: "medium" },
  { id: "opus-medium-2", model: "opus", effort: "medium" },
  { id: "opus-low-1", model: "opus", effort: "low" },
  { id: "opus-low-2", model: "opus", effort: "low" },
  { id: "sonnet-high-1", model: "sonnet", effort: "high" },
  { id: "sonnet-high-2", model: "sonnet", effort: "high" },
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
  { id: "haiku-medium-1", model: "haiku", effort: "medium" },
  { id: "haiku-medium-2", model: "haiku", effort: "medium" },
];

// Production: `DEFAULT_MODEL = "opus"`, and the skeptics inherit the session's effort, which
// is xhigh on the operator's laptop.
export const gold = { id: "gold", model: "opus", effort: "xhigh" };
