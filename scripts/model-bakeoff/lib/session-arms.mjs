// Arms that run as the main thread of their own cloud session (P1-83d). A workflow `agent()` or
// an Agent call is a subagent: another system prompt, no session-level CLAUDE.md, none of a main
// thread's long cached context. The only way here to vary the main model is to start a session
// with `create_session` and a `model`, so each arm is one child session, and everything about it
// is read back from the remote-sessions MCP results this session's transcript already holds.
import { forbiddenCommand, textStructured } from "./transcripts.mjs";
import { cmpTime, sessionUsage } from "./usage.mjs";

export const MODEL_IDS = Object.freeze({
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
  haiku: "claude-haiku-5-5",
});

export function sessionMarker(task, arm) {
  return `(BAKEOFF-SESSION: ${task}/${arm})`;
}

const MARKER = /\(BAKEOFF-SESSION: ([\w-]+)\/([\w-]+)\)\s*$/;

/** What every arm is told around its task, so the arms differ only in their model. */
export function armPrompt(task, arm) {
  return [
    "This session is one arm of a measured bake-off (P1-83d): the same task goes to several sessions, and the answer is scored. Work as you normally would in this repository, reading any file you need, with these limits:",
    "- Make no commits, pushes, posts, issue or PR comments, decision files or other writes outside your scratchpad. Attach no repository and start no other session.",
    "- The inputs below are frozen: treat them as the live state, and do not try to fetch it.",
    "- End your final message with exactly one fenced ```json block holding your answer in the shape the task gives.",
    "",
    task.prompt(),
    "",
    sessionMarker(task.id, arm.id),
  ].join("\n");
}

/** Each child session this run started: `task/arm` → its id and the model it asked for. */
export function children(calls, taskId) {
  const out = new Map();
  for (const c of calls) {
    if (c.tool !== "create_session" || !c.payload?.id) continue;
    const m = String(c.input?.prompt ?? "").match(MARKER);
    if (!m || m[1] !== taskId) continue;
    const key = `${m[1]}/${m[2]}`;
    if (out.has(key)) throw new Error(`two sessions carry the marker ${key}`);
    out.set(key, { arm: m[2], sessionId: c.payload.id, askedModel: c.input.model ?? null });
  }
  return out;
}

const body = (ev) => ev?.result?.internal_anthropic_catchall ?? ev?.result ?? null;
const message = (ev) => ev?.assistant?.internal_anthropic_catchall?.message ?? null;

/**
 * One child as `score` reads it: its last result's text, its cost (each run of the usage
 * counter's last reading, summed, as the usage ledger books it), the models in its
 * `modelUsage`, the newest `configured_model` and `last_served_model` any read gave, and what
 * its main thread ran. Pages that overlap are merged by event uuid.
 */
export function childRecord(sessionId, calls) {
  const events = new Map();
  let newest = null;
  for (const c of calls) {
    if (c.payload?.error) continue;
    if (c.tool === "list_events" && c.input?.session_id === sessionId) {
      for (const ev of c.payload?.data ?? []) {
        const inner = Object.values(ev).find((v) => v && typeof v === "object");
        events.set(inner?.uuid ?? `${ev.created_at}:${events.size}`, ev);
      }
    }
    if (
      ["get_session", "archive_session", "create_session"].includes(c.tool) &&
      c.payload?.id === sessionId &&
      (!newest || cmpTime(c.payload.updated_at, newest.updated_at) >= 0)
    )
      newest = c.payload;
  }
  const all = [...events.values()].sort((a, b) => cmpTime(a.created_at, b.created_at));
  const results = all.filter((ev) => body(ev));
  const usage = sessionUsage(all);
  const models = [...new Set(results.flatMap((ev) => Object.keys(body(ev)?.modelUsage ?? {})))];
  const bash = [];
  const writes = [];
  const servedBy = new Set();
  for (const ev of all) {
    const m = message(ev);
    if (!m || ev.assistant?.internal_anthropic_catchall?.parent_tool_use_id) continue;
    if (m.model) servedBy.add(m.model);
    for (const b of m.content ?? []) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "Bash" && b.input?.command) bash.push(b.input.command);
      if (["Write", "Edit", "NotebookEdit"].includes(b.name))
        writes.push(b.input?.file_path ?? b.input?.notebook_path ?? "");
    }
  }
  const finalText = results.length ? String(body(results.at(-1)).result ?? "") : "";
  return {
    sessionId,
    configuredModel: newest?.configured_model ?? newest?.session_context?.model ?? null,
    lastServedModel: newest?.external_metadata?.last_served_model ?? null,
    mainModels: [...servedBy].sort(),
    models: models.sort(),
    cost: usage ? usage.total : null,
    results: results.length,
    turns: results.reduce((n, ev) => n + (body(ev)?.num_turns ?? 0), 0),
    bash,
    forbidden: bash.filter((cmd) => forbiddenCommand(cmd)),
    writes,
    finalText,
    output: textStructured(finalText),
  };
}

/** Why a child does not count as the arm it was meant to be; empty when it does. */
export function verifyChild(arm, rec, { scratch = /^\/tmp\// } = {}) {
  const want = MODEL_IDS[arm.model] ?? arm.model;
  const label = arm.id;
  const problems = [];
  if (rec.configuredModel !== want)
    problems.push(`${label}: configured ${rec.configuredModel ?? "unknown"}, asked ${want}`);
  if (rec.lastServedModel !== want)
    problems.push(`${label}: last served by ${rec.lastServedModel ?? "unknown"}, asked ${want}`);
  if (rec.mainModels.some((m) => m !== want))
    problems.push(`${label}: main thread ran ${rec.mainModels.join(", ")}, asked ${want}`);
  if (!rec.results) problems.push(`${label}: no result event read`);
  if (!rec.output) problems.push(`${label}: no json block in its last result`);
  if (rec.forbidden.length) problems.push(`${label}: ran ${rec.forbidden.join(" ;; ")}`);
  const outside = rec.writes.filter((p) => !scratch.test(p));
  if (outside.length) problems.push(`${label}: wrote ${outside.join(", ")}`);
  return problems;
}

/** One task's checks for one arm, with its score. */
export function scoreChild(task, rec, truth) {
  const checks = rec.output ? task.check(rec.output, truth) : [];
  const total = task.checkCount ?? checks.length;
  return { checks, correct: checks.filter((c) => c.ok).length, total };
}
