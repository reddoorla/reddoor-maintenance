#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateRun, workDir } from "./lib/arms.mjs";
import {
  MISSING,
  extraCandidates,
  finalScores,
  groupDisagreements,
  referenceFaults,
  scoreRun,
} from "./lib/score.mjs";
import { readAgentTranscript } from "./lib/transcripts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const REFEREE_CHUNK = 90;
export const REFEREE = Object.freeze({ id: "referee", model: "opus", effort: "high" });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n");

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

async function prepare(opts) {
  const task = await loadTask(opts.task);
  const run = resolve(opts.out);
  if (existsSync(run)) throw new Error(`${run} exists; pick a fresh --out`);
  const input = join(run, "input");
  const root = resolve(opts.root || REPO);
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
  freeze(input);
  writeJson(join(run, "manifest.json"), manifest(input));
  writeJson(join(run, "truth.json"), task.truth ? task.truth(input) : null);
  writeJson(join(run, "workflow-args.json"), args);
  console.log(`froze ${walk(input).length} files under ${input}`);
  console.log(`workflow args: ${join(run, "workflow-args.json")}`);
}

// An item task (one agent per arm and item) keys each transcript by `<arm>/<item>`.
const armRunId = (marker) =>
  marker.item === undefined ? marker.id : `${marker.id}/${marker.item}`;

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

function collect(opts) {
  const run = resolve(opts.run);
  const files = walk(resolve(opts.transcripts)).filter((f) => /agent-[^/]*\.jsonl$/.test(f));
  const prior = existsSync(join(run, "runs.json")) ? readJson(join(run, "runs.json")) : {};
  const found = files.map((f) => ({
    transcript: f,
    ...readAgentTranscript(readFileSync(f, "utf8")),
  }));
  const args = readJson(join(run, "workflow-args.json"));
  const { agents, errors } = mergeAgents(prior, found, args);
  if (errors.length) throw new Error(`collect refused:\n  ${errors.join("\n  ")}`);
  writeJson(join(run, "runs.json"), agents);
  for (const [k, a] of Object.entries(agents)) {
    console.log(
      `${k}: models=${a.models.join(",")} efforts=${a.efforts.join(",")} requests=${a.requests} cost=${a.cost === null ? "unpriced" : "$" + a.cost.toFixed(4)} output=${a.structured ? "yes" : "NO"} forbidden=${a.forbidden.length} writes=${a.writes.length} otherTools=${a.otherTools.length}`,
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
  const transcripts = readJson(join(run, "runs.json"));
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
  const truth = readJson(join(run, "truth.json"));
  const gold = agents.gold?.structured;
  const reference = truth ?? gold;
  if (!reference)
    throw new Error("no reference: the task has no truth and the gold run returned nothing");
  problems.push(...referenceFaults(task, reference));
  const all = [args.gold, ...args.arms];
  const scored = all.filter((arm) => agents[arm.id] && !(arm.id === "gold" && !truth));
  const candidates = extraCandidates(
    task,
    reference,
    scored.map((arm) => agents[arm.id].structured),
  );
  const checksByArm = {};
  for (const arm of all) {
    const a = agents[arm.id];
    if (!a) {
      problems.push(`${arm.id}: no transcript found`);
      continue;
    }
    if (!args.items) {
      const p = verifyRan(arm, a, workDir(args.work, arm.id));
      problems.push(...p);
      if (p.length) invalid.add(arm.id);
    }
    if (arm.id === "gold" && !truth) continue;
    checksByArm[arm.id] = scoreRun(task, reference, a.structured, candidates);
  }
  const rulings = {};
  const referees = Object.entries(agents).filter(([k]) => k.startsWith("referee:"));
  for (const [, a] of referees) {
    for (const r of a.structured?.rulings || []) rulings[r.id] = r;
  }
  const disagreements = groupDisagreements(checksByArm).filter((d) => d.armRaw !== MISSING);
  const unruled = disagreements.filter((d) => !rulings[d.id]);
  for (const [k, a] of referees) {
    const work = workDir(args.work, k.replace(":", "-"));
    problems.push(...verifyRan(REFEREE, a, work, { needOutput: unruled.length > 0 }));
  }
  if (unruled.length) {
    problems.push(`${unruled.length} disagreements are unruled; run the referee before reporting`);
    const chunks = [];
    for (let i = 0; i < unruled.length; i += REFEREE_CHUNK)
      chunks.push(unruled.slice(i, i + REFEREE_CHUNK));
    writeJson(join(run, "referee-args.json"), {
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
  const { per, referenceErrors, contradictions, realExtras } = finalScores(checksByArm, rulings);
  for (const c of realExtras) {
    problems.push(
      `${c}: the referee ruled this item real, so the reference is missing it and its field values went unscored; fix the reference and score again`,
    );
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
    arms: all
      .filter((a) => agents[a.id])
      .map((a) => ({
        id: a.id,
        asked: `${a.model} @ ${a.effort}`,
        ran: `${agents[a.id].models.join(",")} @ ${agents[a.id].efforts.join(",")}`,
        score: per[a.id] ? `${per[a.id].correct}/${per[a.id].total}` : "(reference)",
        cost: agents[a.id].cost,
        requests: agents[a.id].requests,
        longPrompt: agents[a.id].longPrompt,
        errors: per[a.id]?.errors.slice(0, 20) || [],
      })),
  };
  if (task.decision) {
    result.decision = task.decision(
      Object.fromEntries(all.filter((a) => agents[a.id]).map((a) => [a.id, agents[a.id]])),
      args.dir,
      { arms: all, invalid: [...invalid], referenceErrors, unruled: unruled.length, blockers },
    );
  }
  writeJson(join(run, "result.json"), result);
  console.log(formatResult(result));
  if (unruled.length) console.log(`\nreferee args: ${join(run, "referee-args.json")}`);
  if (problems.length) process.exitCode = 1;
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
      `| ${a.id} | ${a.asked} | ${a.ran} | ${a.score} | ${a.cost === null ? "unpriced" : "$" + a.cost.toFixed(2)} | ${a.requests} | ${a.longPrompt} |`,
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
