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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateRun, workDir } from "./lib/arms.mjs";
import { MISSING, finalScores, groupDisagreements, scoreRun } from "./lib/score.mjs";
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
    walk(dir, [], true).map((f) => {
      const st = statSync(f);
      const mode = (st.mode & 0o777).toString(8);
      return [
        relative(dir, f),
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

export function agentKey(marker) {
  return marker.kind === "arm" ? marker.id : `referee:${marker.id}`;
}

export function mergeAgents(prior, found) {
  const agents = { ...prior };
  const errors = [];
  for (const t of found) {
    if (t.markerError) {
      errors.push(`${t.transcript}: ${t.markerError}`);
      continue;
    }
    if (!t.marker) continue;
    const key = agentKey(t.marker);
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
  const { agents, errors } = mergeAgents(prior, found);
  if (errors.length) throw new Error(`collect refused:\n  ${errors.join("\n  ")}`);
  writeJson(join(run, "runs.json"), agents);
  for (const [k, a] of Object.entries(agents)) {
    console.log(
      `${k}: models=${a.models.join(",")} efforts=${a.efforts.join(",")} requests=${a.requests} cost=${a.cost === null ? "unpriced" : "$" + a.cost.toFixed(4)} output=${a.structured ? "yes" : "NO"} forbidden=${a.forbidden.length} writes=${a.writes.length} mcp=${a.mcp.length}`,
    );
  }
}

const MODEL_IDS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export function verifyRan(arm, agent, work) {
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
  if (!agent.structured) problems.push(`${label}: no accepted structured output`);
  if (agent.forbidden.length)
    problems.push(`${label}: ran forbidden commands: ${agent.forbidden.join(" ;; ")}`);
  if (agent.mcp?.length) problems.push(`${label}: used MCP tools: ${agent.mcp.join(", ")}`);
  if (work) {
    const outside = (agent.writes || []).filter((p) => p !== work && !p.startsWith(`${work}/`));
    if (outside.length) problems.push(`${label}: wrote outside ${work}: ${outside.join(", ")}`);
  }
  return problems;
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
  const agents = readJson(join(run, "runs.json"));
  const problems = [];
  if (resolve(args.dir) !== join(run, "input")) {
    problems.push(`args.dir ${args.dir} is not this run's frozen input ${join(run, "input")}`);
  }
  const before = readJson(join(run, "manifest.json"));
  const after = manifest(join(run, "input"));
  if (JSON.stringify(before) !== JSON.stringify(after))
    problems.push("the frozen input changed during the run");
  const truth = readJson(join(run, "truth.json"));
  const gold = agents.gold?.structured;
  const reference = truth ?? gold;
  if (!reference)
    throw new Error("no reference: the task has no truth and the gold run returned nothing");
  const all = [args.gold, ...args.arms];
  const checksByArm = {};
  for (const arm of all) {
    const a = agents[arm.id];
    if (!a) {
      problems.push(`${arm.id}: no transcript found`);
      continue;
    }
    problems.push(...verifyRan(arm, a, workDir(args.work, arm.id)));
    if (arm.id === "gold" && !truth) continue;
    checksByArm[arm.id] = scoreRun(task, reference, a.structured || {});
  }
  const rulings = {};
  for (const [k, a] of Object.entries(agents)) {
    if (!k.startsWith("referee:")) continue;
    problems.push(...verifyRan(REFEREE, a, workDir(args.work, k.replace(":", "-"))));
    for (const r of a.structured?.rulings || []) rulings[r.id] = r;
  }
  const disagreements = groupDisagreements(checksByArm).filter((d) => d.armRaw !== MISSING);
  const unruled = disagreements.filter((d) => !rulings[d.id]);
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
  const { per, referenceErrors } = finalScores(checksByArm, rulings);
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
  if (r.problems.length) lines.push("", "Problems:", ...r.problems.map((p) => `- ${p}`));
  return lines.join("\n");
}

const COMMANDS = { prepare, collect, score };

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
      "usage: bakeoff.mjs prepare --task <id> --out <dir> [--arms <file>] | collect --run <dir> --transcripts <dir> | score --run <dir>",
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
