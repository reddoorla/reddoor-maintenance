#!/usr/bin/env node
// Main-thread arms, one cloud session each (P1-83d; lib/session-arms.mjs says why).
//
//   node scripts/model-bakeoff/session-arms.mjs prompts --task <id> [--run <tag>]
//   node scripts/model-bakeoff/session-arms.mjs score   --task <id> [--run <tag>] [--root <dir>] [--json <file>]
//
// `prompts` prints each arm's create_session input. Start each with the remote-sessions
// `create_session` tool, read it back with `list_events` (every page, no `kinds`) and
// `get_session` once it is idle, then `score` reads those results out of this session's
// transcripts under `--root` (default ~/.claude/projects) and scores each arm.
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  MODEL_IDS,
  armPrompt,
  childRecord,
  children,
  scoreChild,
  verifyChild,
} from "./lib/session-arms.mjs";
import { mcpCalls } from "./lib/usage.mjs";
import * as cockpit from "./tasks/session-cockpit.mjs";
import * as decision from "./tasks/session-decision.mjs";
import * as firstScreen from "./tasks/session-first-screen.mjs";

const WORKSPACE = "https://github.com/reddoorla/reddoor-workspace";

const TASKS = Object.fromEntries([decision, firstScreen, cockpit].map((t) => [t.id, t]));

function loadTask(id) {
  const task = TASKS[id];
  if (!task) throw new Error(`unknown task ${id}; one of ${Object.keys(TASKS).join(", ")}`);
  return task;
}

export function scoreTask(task, calls, run = "") {
  const kids = children(calls, task.id, run);
  const truth = task.truth();
  const rows = task.arms.map((arm) => {
    const kid = kids.get(`${task.id}/${arm.id}`);
    if (!kid)
      return { arm, problems: [`${arm.id}: no session found`], correct: 0, total: task.checkCount };
    const rec = childRecord(kid.sessionId, calls);
    const problems = verifyChild(arm, rec);
    if (kid.askedModel !== (MODEL_IDS[arm.model] ?? arm.model))
      problems.push(`${arm.id}: create_session asked for ${kid.askedModel}`);
    return { arm, rec, problems, ...scoreChild(task, rec, truth) };
  });
  return { task: task.id, truth, rows };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      task: { type: "string" },
      run: { type: "string", default: "" },
      root: { type: "string", default: join(homedir(), ".claude", "projects") },
      json: { type: "string" },
    },
  });
  const task = loadTask(values.task);
  if (cmd === "prompts") {
    const out = task.arms.map((arm) => ({
      arm: arm.id,
      model: MODEL_IDS[arm.model] ?? arm.model,
      title: `P1-83d bake-off: ${task.id}/${arm.id} (archive me)`,
      source_url: WORKSPACE,
      permission_mode: "auto",
      prompt: armPrompt(task, arm, values.run),
    }));
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }
  if (cmd !== "score") throw new Error("usage: session-arms.mjs prompts|score --task <id>");
  const result = scoreTask(task, mcpCalls(values.root), values.run);
  if (values.json) writeFileSync(values.json, JSON.stringify(result, null, 2) + "\n");
  console.log(`| Arm | Score | Cost | Turns | Models | Session |`);
  console.log(`|---|---|---|---|---|---|`);
  for (const r of result.rows) {
    const cost = r.rec?.cost == null ? "?" : `$${r.rec.cost.toFixed(4)}`;
    console.log(
      `| ${r.arm.id} | ${r.correct}/${r.total} | ${cost} | ${r.rec?.turns ?? "?"} | ${r.rec?.models.join(", ") ?? "?"} | ${r.rec?.sessionId ?? "none"} |`,
    );
  }
  for (const r of result.rows)
    for (const c of r.checks ?? [])
      if (!c.ok)
        console.log(
          `miss ${r.arm.id} ${c.check}: got ${JSON.stringify(c.got)}, want ${JSON.stringify(c.want)}`,
        );
  const problems = result.rows.flatMap((r) => r.problems);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`session-arms: ${e.message}`);
    process.exitCode = 2;
  }
}
