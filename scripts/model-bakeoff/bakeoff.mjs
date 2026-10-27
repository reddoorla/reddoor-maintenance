#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AGENT_TYPE, validateRun, workDir } from "./lib/arms.mjs";
import {
  MISSING,
  extraCandidates,
  finalScores,
  groupDisagreements,
  referenceFaults,
  scoreRun,
} from "./lib/score.mjs";
import { LOWER_BOUND_NOTE, formatCost } from "./lib/ledger.mjs";
import { readAgentTranscript } from "./lib/transcripts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const REFEREE_CHUNK = 90;
export const REFEREE = Object.freeze({ id: "referee", model: "opus", effort: "high" });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n");

/**
 * Where a run's truth (its answer key) lives: beside the run directory, never inside it. The
 * arms are told `<run>/input` and `<run>/work/<id>`, so a `cat <run>/*.json` or a Grep over the
 * run must not reach the key (#1492). `secretReads` still catches a read that names the file.
 */
export function truthPath(run) {
  return `${resolve(run)}.truth.json`;
}

/**
 * Where `collect` keeps the agents it read, and where `score` writes the referee's args: beside
 * the run too. Both hold the reference's values (the gold's output, each disagreement's
 * REFERENCE), and an arm launched after a `collect` (the per-arm `only` flow) could read them
 * inside the run (#1540).
 */
export function runsPath(run) {
  return `${resolve(run)}.runs.json`;
}
export function refereeArgsPath(run) {
  return `${resolve(run)}.referee-args.json`;
}
// score's result lists each arm's errors with the reference's value beside them.
export function resultPath(run) {
  return `${resolve(run)}.result.json`;
}

// The files a run kept inside it before the move. Neither collect nor score reads, merges or
// writes past one, which would leave the old copy for a later arm to read.
const MOVED = {
  "runs.json": runsPath,
  "referee-args.json": refereeArgsPath,
  "result.json": resultPath,
};
function refuseInsideRuns(run) {
  for (const [name, to] of Object.entries(MOVED)) {
    const old = join(run, name);
    if (existsSync(old))
      throw new Error(
        `${old} is inside the run, where its arms could read it (#1540). Move it to ${to(run)} (or delete it) first.`,
      );
  }
}

export async function loadTask(name) {
  const file = join(HERE, "tasks", `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`no task ${name} (looked for ${relative(REPO, file)})`);
  return import(file);
}

function walk(dir, out = [], withDirs = false) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (withDirs) out.push(p);
      walk(p, out, withDirs);
    } else out.push(p);
  }
  return out.sort();
}

export function manifest(dir) {
  return Object.fromEntries(
    [dir, ...walk(dir, [], true)].map((f) => {
      const st = statSync(f);
      const mode = (st.mode & 0o777).toString(8);
      return [
        relative(dir, f) || ".",
        st.isDirectory() ? `dir:${mode}` : `${mode}:${sha256(readFileSync(f))}`,
      ];
    }),
  );
}

function freeze(dir) {
  for (const f of walk(dir)) chmodSync(f, 0o444);
  const dirs = [dir, ...walk(dir, [], true).filter((p) => statSync(p).isDirectory())];
  for (const d of dirs.reverse()) chmodSync(d, 0o555);
}

// Item ids travel in the transcript marker, which reads only this shape.
const ITEM_ID = /^[a-z0-9][a-z0-9-]*$/;

function checkedItems(items) {
  const bad = items.filter((i) => !ITEM_ID.test(i.id)).map((i) => JSON.stringify(i.id));
  if (bad.length) throw new Error(`item ids must match ${ITEM_ID}: ${bad.join(", ")}`);
  return items;
}

export function extractArgs(
  task,
  inputDir,
  arms = task.arms,
  work = join(dirname(inputDir), "work"),
) {
  const errors = validateRun(arms, task.gold);
  if (errors.length) throw new Error(`refusing to build the run:\n  ${errors.join("\n  ")}`);
  return {
    mode: "extract",
    task: task.id,
    dir: inputDir,
    work,
    prompt: task.prompt(inputDir),
    goldAddendum: task.goldAddendum,
    schema: task.schema,
    ...(task.items ? { items: checkedItems(task.items(inputDir)) } : {}),
    gold: task.gold,
    arms,
  };
}

// Builds a run dir, or none: a step that throws (a setup, a truth) removes what it had built, so
// the same --out can be used again. `task` defaults to the module `opts.task` names.
export async function prepare(opts, task) {
  task ??= await loadTask(opts.task);
  // score would refuse it, after every arm had been paid for.
  if (task.observe && !task.truth) {
    throw new Error(
      `${task.id}: a task with observe() needs a truth; the gold cannot be the reference`,
    );
  }
  const run = resolve(opts.out);
  // lstat, not existsSync: a dangling symlink at --out is there too, and is not prepare's to use.
  // The files collect and score write beside the run too: a stale one would be merged into this
  // run (#1540).
  for (const p of [run, truthPath(run), runsPath(run), refereeArgsPath(run), resultPath(run)]) {
    if (lstatSync(p, { throwIfNoEntry: false })) throw new Error(`${p} exists; pick a fresh --out`);
  }
  const input = join(run, "input");
  const root = resolve(opts.root || REPO);
  // The first directory this call creates (run, or a parent it lacked): all a failure removes.
  const made = mkdirSync(run, { recursive: true });
  try {
    for (const s of task.sources) {
      const to = join(input, s.to);
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(join(root, s.from)).sort()) {
        const src = join(root, s.from, name);
        if (s.match.test(name) && statSync(src).isFile()) copyFileSync(src, join(to, name));
      }
    }
    const arms = opts.arms ? readJson(resolve(opts.arms)) : task.arms;
    const args = extractArgs(task, input, arms);
    mkdirSync(args.work, { recursive: true });
    const ids = [args.gold.id, ...args.arms.map((a) => a.id)];
    if (task.setup) task.setup({ input, work: args.work, ids, root: opts.root && root });
    freeze(input);
    writeJson(join(run, "manifest.json"), manifest(input));
    writeJson(truthPath(run), task.truth ? task.truth(input) : null);
    writeJson(join(run, "workflow-args.json"), args);
    console.log(`froze ${walk(input).length} files under ${input}`);
    console.log(`workflow args: ${join(run, "workflow-args.json")}`);
  } catch (e) {
    // Best effort: a cleanup that fails must not replace the error that stopped the build.
    try {
      // The frozen input's directories are read-only, which stops a non-root rm inside them.
      if (existsSync(input)) {
        for (const d of [input, ...walk(input, [], true)].filter((p) => statSync(p).isDirectory()))
          chmodSync(d, 0o755);
      }
    } catch {
      // rmSync below still tries.
    }
    try {
      if (made) rmSync(made, { recursive: true, force: true });
      // The truth sits outside `made`; the --out check above proved any there is this call's.
      rmSync(truthPath(run), { force: true });
    } catch {
      // The original error is the one to report.
    }
    throw e;
  }
}

// An item task (one agent per arm and item) keys each transcript by `<arm>/<item>`.
const armRunId = (marker) =>
  marker.item === undefined ? marker.id : `${marker.id}/${marker.item}`;

/** The scorer a task uses: lib/score.mjs's, with any of these three the task exports in its place. */
export function scorerFor(task) {
  const s = { referenceFaults, extraCandidates, scoreRun };
  for (const k of Object.keys(s)) if (typeof task[k] === "function") s[k] = task[k];
  return s;
}

export function agentKey(marker) {
  return marker.kind === "arm" ? armRunId(marker) : `referee:${marker.id}`;
}

export function expectedWork(args, marker) {
  return workDir(args.work, marker.kind === "arm" ? armRunId(marker) : `referee-${marker.id}`);
}

export function mergeAgents(prior, found, args) {
  const agents = { ...prior };
  const errors = [];
  const armIds = new Set([args.gold.id, ...args.arms.map((a) => a.id)]);
  for (const t of found) {
    if (t.markerError) {
      errors.push(`${t.transcript}: ${t.markerError}`);
      continue;
    }
    if (!t.marker) continue;
    const key = agentKey(t.marker);
    if (t.marker.kind === "referee" && !/^r\d+-\d+$/.test(t.marker.id)) {
      errors.push(`${t.transcript}: referee marker ${t.marker.id} is not r<round>-<chunk>`);
      continue;
    }
    if (t.marker.kind === "arm" && !armIds.has(t.marker.id)) {
      errors.push(`${t.transcript}: marker ${key} names no arm of this run`);
      continue;
    }
    if (t.marker.kind === "arm" && Array.isArray(args.items)) {
      if (!args.items.some((i) => i.id === t.marker.item)) {
        errors.push(`${t.transcript}: marker ${key} names no item of this run`);
        continue;
      }
    } else if (t.marker.item !== undefined) {
      errors.push(`${t.transcript}: marker ${key} names an item, and this run has none`);
      continue;
    }
    const work = expectedWork(args, t.marker);
    if (!t.prompt.includes(args.dir) || !t.prompt.includes(`${work}.`)) {
      errors.push(
        `${t.transcript}: ${key}'s prompt does not name this run's input ${args.dir} and work dir ${work}`,
      );
      continue;
    }
    if (agents[key] && agents[key].transcript !== t.transcript) {
      errors.push(`${key} has two transcripts: ${agents[key].transcript} and ${t.transcript}`);
      continue;
    }
    agents[key] = t;
  }
  return { agents, errors };
}

/**
 * One subagent transcript as `collect` keeps it: what `readAgentTranscript` reads, the file, and
 * the agent type it ran as, from the sibling `agent-<id>.meta.json` the harness writes. A
 * launcher split before the agent type existed runs as the default agent, and only that file
 * says so.
 */
export function collectFile(file) {
  if (!file.endsWith(".jsonl")) throw new Error(`${file}: not a .jsonl transcript`);
  return {
    transcript: file,
    agentType: recordedAgentType(file.replace(/\.jsonl$/, ".meta.json")),
    ...readAgentTranscript(readFileSync(file, "utf8")),
  };
}

// Null when the meta file is missing, is not JSON or names no type: `score` then reports that
// agent, rather than one stray file stopping the whole collect.
function recordedAgentType(meta) {
  let m;
  try {
    m = readJson(meta);
  } catch {
    return null;
  }
  return typeof m?.agentType === "string" && m.agentType !== "" ? m.agentType : null;
}

function collect(opts) {
  const run = resolve(opts.run);
  const files = walk(resolve(opts.transcripts)).filter((f) => /agent-[^/]*\.jsonl$/.test(f));
  refuseInsideRuns(run);
  const prior = existsSync(runsPath(run)) ? readJson(runsPath(run)) : {};
  const found = files.map(collectFile);
  const args = readJson(join(run, "workflow-args.json"));
  const { agents, errors } = mergeAgents(prior, found, args);
  if (errors.length) throw new Error(`collect refused:\n  ${errors.join("\n  ")}`);
  writeJson(runsPath(run), agents);
  for (const [k, a] of Object.entries(agents)) {
    console.log(
      `${k}: agentType=${a.agentType ?? "none"} models=${a.models.join(",")} efforts=${a.efforts.join(",")} requests=${a.requests} cost=${formatCost(a.cost, a.unfinished, a.requests, 4)} output=${a.structured ? "yes" : "NO"} forbidden=${a.forbidden.length} writes=${a.writes.length} otherTools=${a.otherTools.length}`,
    );
  }
}

const MODEL_IDS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export function verifyRan(arm, agent, work, { needOutput = true } = {}) {
  const problems = [];
  const label = agent.marker ? agentKey(agent.marker) : arm.id;
  const want = MODEL_IDS[arm.model] || arm.model;
  if (agent.models.length !== 1 || agent.models[0] !== want) {
    problems.push(
      `${label}: asked for ${want}, transcripts show ${agent.models.join(", ") || "none"}`,
    );
  }
  if (agent.efforts.length !== 1 || agent.efforts[0] !== arm.effort) {
    problems.push(
      `${label}: asked for effort ${arm.effort}, transcripts show ${agent.efforts.join(", ") || "none"}`,
    );
  }
  if (agent.agentType === undefined) {
    problems.push(
      `${label}: no agent type in runs.json, which predates the agent-type check; collect again to read it from the .meta.json (a run launched before 2026-10-20 then shows as the default agent and must be launched again)`,
    );
  } else if (agent.agentType === null) {
    problems.push(
      `${label}: no agent type recorded (its .meta.json is missing, unreadable or names none), so it cannot be shown to be ${AGENT_TYPE}`,
    );
  } else if (agent.agentType !== AGENT_TYPE) {
    problems.push(`${label}: ran as agent type ${agent.agentType}, not ${AGENT_TYPE}`);
  }
  if (needOutput && !agent.structured) problems.push(`${label}: no accepted structured output`);
  if (agent.forbidden.length)
    problems.push(`${label}: ran forbidden commands: ${agent.forbidden.join(" ;; ")}`);
  if (agent.otherTools?.length) {
    problems.push(`${label}: used tools outside the allowlist: ${agent.otherTools.join(", ")}`);
  }
  if (work) {
    const root = resolve(work);
    const outside = (agent.writes || []).filter((p) => {
      if (!isAbsolute(p)) return true;
      const r = resolve(p);
      return r !== root && !r.startsWith(`${root}/`);
    });
    if (outside.length) problems.push(`${label}: wrote outside ${work}: ${outside.join(", ")}`);
  }
  return problems;
}

/**
 * One record per arm of an item run, built from its per-item transcripts, so the rest of
 * `score` treats it as one agent. Each item agent is checked on its own first: what ran, its
 * output, its writes (inside `<work>/<arm>/<item>`). The arm's output is `task.assemble`d
 * from the item outputs it has, and a missing item is a problem, scored as an absent answer.
 */
export function combineItems(task, args, agents, arm) {
  const problems = [];
  const parts = [];
  const outputs = {};
  for (const item of args.items) {
    const key = `${arm.id}/${item.id}`;
    const a = agents[key];
    if (!a) {
      problems.push(`${key}: no transcript found`);
      continue;
    }
    problems.push(...verifyRan(arm, a, workDir(args.work, key)));
    parts.push(a);
    if (a.structured) outputs[item.id] = a.structured;
  }
  if (parts.length === 0) return { record: null, problems };
  const union = (f) => [...new Set(parts.flatMap(f))].sort();
  const sum = (f) => parts.reduce((n, a) => n + f(a), 0);
  return {
    record: {
      models: union((a) => a.models),
      efforts: union((a) => a.efforts),
      requests: sum((a) => a.requests),
      unfinished: sum((a) => a.unfinished ?? 0),
      cost: parts.some((a) => a.cost === null) ? null : sum((a) => a.cost),
      longPrompt: sum((a) => a.longPrompt),
      bash: parts.flatMap((a) => a.bash || []),
      reads: parts.flatMap((a) => a.reads || []),
      structured: Object.keys(outputs).length ? task.assemble(outputs, args.dir) : null,
    },
    problems,
  };
}

/** Agents whose commands or reads name one of the task's secrets, such as its answer key. */
export function secretReads(secrets, agents) {
  const hits = [];
  for (const [k, a] of Object.entries(agents)) {
    const seen = [...(a.bash || []), ...(a.reads || [])];
    for (const s of secrets) {
      if (seen.some((x) => x.includes(s))) hits.push(`${k}: read or ran a command naming ${s}`);
    }
  }
  return hits;
}

// Scores the gold (when a truth exists) and every arm. A task with observe() must have a truth:
// the gold's raw output is not in the shape observe() returns, so it cannot be the reference.
export function scoreArms(task, args, agents, reference, truth) {
  const problems = [];
  const checksByArm = {};
  // Arms with a problem of their own, for a task's decision hook.
  const invalid = [];
  // A refused run still reports what ran wrong in each arm; it only scores nothing.
  const refused = Boolean(task.observe && !truth);
  if (refused) {
    problems.push(
      `${args.task}: a task with observe() needs a truth; the gold cannot be the reference`,
    );
  }
  const all = [args.gold, ...args.arms];
  for (const arm of all) {
    const a = agents[arm.id];
    if (!a) {
      problems.push(`${arm.id}: no transcript found`);
      continue;
    }
    // An item run's arm record is assembled from item agents `combineItems` already checked.
    if (!args.items) {
      const p = verifyRan(arm, a, workDir(args.work, arm.id));
      problems.push(...p);
      if (p.length) invalid.push(arm.id);
    }
  }
  if (refused) return { checksByArm, problems, invalid };
  const scored = all.filter((arm) => agents[arm.id] && !(arm.id === "gold" && !truth));
  const output = (arm) => armOutput(task, args, arm, agents[arm.id], reference);
  const scorer = scorerFor(task);
  const candidates = scorer.extraCandidates(task, reference, scored.map(output));
  for (const arm of scored) {
    checksByArm[arm.id] = scorer.scoreRun(task, reference, output(arm), candidates);
  }
  return { checksByArm, problems, invalid };
}

// What is scored for one agent: its structured output, or, for a task that exports
// observe(work, structured, agent, reference), what that reads from the agent's work dir and
// transcript, given the reference it will be scored against.
export function armOutput(task, args, arm, agent, reference) {
  const structured = agent?.structured ?? null;
  return task.observe
    ? task.observe(workDir(args.work, arm.id), structured, agent, reference)
    : structured;
}

export function nextRound(agents) {
  let max = 0;
  for (const k of Object.keys(agents)) {
    const m = /^referee:r(\d+)-\d+$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function score(opts) {
  const run = resolve(opts.run);
  const args = readJson(join(run, "workflow-args.json"));
  const task = await loadTask(args.task);
  refuseInsideRuns(run);
  const transcripts = readJson(runsPath(run));
  const problems = [];
  // Arms `score` found a problem in, for a task's decision hook.
  const invalid = new Set();
  // Problems that are no one arm's: they stop a task's decision from ranking at all.
  const blockers = [];
  if (task.secrets) {
    const hits = secretReads(task.secrets, transcripts);
    problems.push(...hits);
    for (const h of hits) {
      if (h.startsWith("referee:")) blockers.push(h);
      else invalid.add(h.split(/[/:]/)[0]);
    }
  }
  const agents = { ...transcripts };
  if (Array.isArray(args.items)) {
    for (const arm of [args.gold, ...args.arms]) {
      const { record, problems: p } = combineItems(task, args, transcripts, arm);
      problems.push(...p);
      if (p.length) invalid.add(arm.id);
      if (record) agents[arm.id] = record;
    }
  }
  if (resolve(args.dir) !== join(run, "input")) {
    const p = `args.dir ${args.dir} is not this run's frozen input ${join(run, "input")}`;
    problems.push(p);
    blockers.push(p);
  }
  const before = readJson(join(run, "manifest.json"));
  const after = manifest(join(run, "input"));
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    problems.push("the frozen input changed during the run");
    blockers.push("the frozen input changed during the run");
  }
  const truthFile = truthPath(run);
  if (!existsSync(truthFile)) {
    const old = join(run, "truth.json");
    throw new Error(
      existsSync(old)
        ? `no truth at ${truthFile}; this run keeps it at ${old}, where its arms could read it (#1492). Move it to ${truthFile} to score.`
        : `no truth at ${truthFile}; prepare writes it (null when the task has no truth)`,
    );
  }
  const truth = readJson(truthFile);
  const gold = agents.gold?.structured;
  const reference = truth ?? gold;
  if (!reference)
    throw new Error("no reference: the task has no truth and the gold run returned nothing");
  const scorer = scorerFor(task);
  const faults = scorer.referenceFaults(task, reference);
  problems.push(...faults);
  blockers.push(...faults);
  const all = [args.gold, ...args.arms];
  const {
    checksByArm,
    problems: armProblems,
    invalid: faulted,
  } = scoreArms(task, args, agents, reference, truth);
  problems.push(...armProblems);
  for (const id of faulted) invalid.add(id);
  const rulings = {};
  const referees = Object.entries(agents).filter(([k]) => k.startsWith("referee:"));
  for (const [, a] of referees) {
    for (const r of a.structured?.rulings || []) rulings[r.id] = r;
  }
  const disagreements = groupDisagreements(checksByArm).filter((d) => d.armRaw !== MISSING);
  const unruled = disagreements.filter((d) => !rulings[d.id]);
  for (const [k, a] of referees) {
    const work = workDir(args.work, k.replace(":", "-"));
    const p = verifyRan(REFEREE, a, work, { needOutput: unruled.length > 0 });
    problems.push(...p);
    blockers.push(...p);
  }
  if (unruled.length) {
    problems.push(`${unruled.length} disagreements are unruled; run the referee before reporting`);
    const chunks = [];
    for (let i = 0; i < unruled.length; i += REFEREE_CHUNK)
      chunks.push(unruled.slice(i, i + REFEREE_CHUNK));
    writeJson(refereeArgsPath(run), {
      mode: "referee",
      task: args.task,
      dir: args.dir,
      work: args.work,
      prompt: args.prompt,
      round: nextRound(agents),
      referee: REFEREE,
      chunks: chunks.map((c) =>
        c.map((d) => ({ id: d.id, check: d.check, ARM: d.armRaw, REFERENCE: d.refRaw })),
      ),
    });
  }
  const { per, referenceErrors, referenceDisputes, contradictions, realExtras } = finalScores(
    checksByArm,
    rulings,
  );
  for (const c of realExtras) {
    const p = `${c}: the referee ruled this item real, so the reference is missing it and its field values went unscored; fix the reference and score again`;
    problems.push(p);
    blockers.push(p);
  }
  for (const c of contradictions) {
    problems.push(`${c}: the referee's rulings disagree about whether the reference is right`);
    blockers.push(`${c}: the referee's rulings disagree about whether the reference is right`);
  }
  const result = {
    task: args.task,
    reference: truth ? "script truth" : "gold run",
    problems,
    disagreements: disagreements.length,
    unruled: unruled.length,
    referenceErrors,
    referenceDisputes,
    arms: all
      .filter((a) => agents[a.id])
      .map((a) => ({
        id: a.id,
        asked: `${a.model} @ ${a.effort}`,
        ran: `${agents[a.id].models.join(",")} @ ${agents[a.id].efforts.join(",")}`,
        score: per[a.id] ? `${per[a.id].correct}/${per[a.id].total}` : "(reference)",
        cost: agents[a.id].cost,
        requests: agents[a.id].requests,
        unfinished: agents[a.id].unfinished,
        longPrompt: agents[a.id].longPrompt,
        byCollection: per[a.id] ? byCollection(per[a.id].byField) : undefined,
        errors: per[a.id]?.errors.slice(0, 20) || [],
      })),
  };
  if (typeof task.summarize === "function") {
    const outputs = Object.fromEntries(
      Object.keys(checksByArm).map((k) => [k, agents[k].structured]),
    );
    // Every arm that should have run, so one with no transcript reads as pending
    // (#1463). A gold run that is the reference is not scored.
    const expected = truth ? all : args.arms;
    result.summary = task.summarize({ reference, checksByArm, rulings, outputs, arms: expected });
  }
  if (task.decision) {
    result.decision = task.decision(
      Object.fromEntries(all.filter((a) => agents[a.id]).map((a) => [a.id, agents[a.id]])),
      args.dir,
      {
        arms: all,
        invalid: [...invalid],
        referenceErrors,
        unruled: unruled.length,
        blockers,
        checksByArm,
        rulings,
      },
    );
  }
  writeJson(resultPath(run), result);
  console.log(formatResult(result));
  if (result.summary && typeof task.formatSummary === "function") {
    console.log(task.formatSummary(result.summary));
  }
  if (unruled.length) console.log(`\nreferee args: ${refereeArgsPath(run)}`);
  if (problems.length) process.exitCode = 1;
}

// "correct/total" per collection, so a total dominated by one collection cannot hide another.
export function byCollection(byField) {
  const out = {};
  for (const [key, { total, correct }] of Object.entries(byField)) {
    const col = key.slice(0, key.indexOf("."));
    const c = (out[col] ??= { total: 0, correct: 0 });
    c.total += total;
    c.correct += correct;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.correct}/${v.total}`]));
}

export function formatResult(r) {
  const lines = [
    `Reference: ${r.reference}. Distinct disagreements: ${r.disagreements} (${r.unruled} unruled).`,
    "",
    "| Arm | Asked | Ran (transcripts) | Score | Cost per run | Requests | Long-prompt requests |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const a of r.arms) {
    lines.push(
      `| ${a.id} | ${a.asked} | ${a.ran} | ${a.score} | ${formatCost(a.cost, a.unfinished, a.requests)} | ${a.requests} | ${a.longPrompt} |`,
    );
  }
  // Only a priced cost prints ≥, so only one explains the note.
  if (r.arms.some((a) => a.unfinished && a.cost !== null)) lines.push("", LOWER_BOUND_NOTE);
  if (r.referenceDisputes?.length) {
    lines.push(
      "",
      "Reference disputes (the reference is right by construction, so its matches keep these checks):",
      ...r.referenceDisputes.map((d) => `- ${d.check}: reference ${d.reference}. ${d.note}`.trim()),
    );
  }
  if (r.decision?.lines) lines.push("", ...r.decision.lines);
  if (r.problems.length) lines.push("", "Problems:", ...r.problems.map((p) => `- ${p}`));
  return lines.join("\n");
}

/**
 * One launcher script per arm (gold included). Each holds the bake-off workflow's body,
 * wrapped in a function and called with the run's workflow args, `only` set to that arm. A
 * workflow runs at most min(16, CPUs - 2) agents at once, two in a 4-CPU container, and an
 * item run's args are too large to paste into a Workflow call; launching each file with
 * `scriptPath` gives every arm its own slots without retyping the args. The body is embedded
 * rather than loaded with `workflow({ scriptPath })`, which refuses a file outside the
 * session's working directory, such as a worktree's.
 */
export function launchers(args, source) {
  const meta = /^export const meta = \{[\s\S]*?\n\};\n/m;
  if (!meta.test(source)) throw new Error("the workflow source has no `export const meta` block");
  const body = source.replace(meta, "");
  return [args.gold, ...args.arms].map((a) => ({
    id: a.id,
    script: [
      "export const meta = {",
      `  name: "bakeoff-${args.task}-${a.id}",`,
      `  description: "Bake-off ${args.task}: arm ${a.id} (${a.model} @ ${a.effort})",`,
      '  phases: [{ title: "Extract" }],',
      "};",
      "",
      "return await (async (args) => {",
      body,
      `})(${JSON.stringify({ ...args, only: [a.id] })});`,
      "",
    ].join("\n"),
  }));
}

function split(opts) {
  const run = resolve(opts.run);
  const args = readJson(join(run, "workflow-args.json"));
  const dir = join(run, "launch");
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(join(REPO, ".claude/workflows/model-bakeoff.workflow.js"), "utf8");
  for (const l of launchers(args, source)) {
    writeFileSync(join(dir, `${l.id}.workflow.js`), l.script);
    console.log(join(dir, `${l.id}.workflow.js`));
  }
}

const COMMANDS = { prepare, collect, score, split };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      task: { type: "string" },
      out: { type: "string" },
      root: { type: "string" },
      arms: { type: "string" },
      run: { type: "string" },
      transcripts: { type: "string" },
    },
  });
  const cmd = COMMANDS[positionals[0]];
  if (!cmd) {
    console.error(
      "usage: bakeoff.mjs prepare --task <id> --out <dir> [--arms <file>] | split --run <dir> | collect --run <dir> --transcripts <dir> | score --run <dir>",
    );
    process.exit(2);
  }
  try {
    await cmd(values);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
