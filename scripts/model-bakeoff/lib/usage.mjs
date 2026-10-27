// The per-model usage ledger (P1-83, reddoorla/reddoor-workspace#3): rows of tokens and list-price
// cost per session, per model and, where a transcript survives, per agent. The data are private
// and live in the workspace's `usage/`; this file only reads and writes them. Never commit a real
// session ID, title or cost here or in a test: this repo is public.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { PRICE_SOURCE, priceRequest, splitLines, usageRecords } from "./ledger.mjs";

export const COLUMNS = Object.freeze([
  "session_id",
  "session_created_at",
  "environment",
  "source",
  "agent_id",
  "agent_type",
  "effort",
  "model",
  "requests",
  "input_tokens",
  "output_tokens",
  "thinking_tokens",
  "cache_read_tokens",
  "cache_write_5m_tokens",
  "cache_write_1h_tokens",
  "cache_write_unsplit_tokens",
  "web_search_requests",
  "unfinished_requests",
  "cost_usd",
  "cost_basis",
  "run_from",
  "run_from_cost_usd",
  "run_total_usd",
  "as_of",
  "history",
]);

export const SESSION_COLUMNS = Object.freeze([
  "session_id",
  "created_at",
  "updated_at",
  "title",
  "origin",
  "environment",
  "status",
  "coverage",
  "history",
  "as_of",
  "result_segments",
  "result_total_cost_usd",
  "model_usage_total_usd",
  "get_session_cost_usd",
  "get_session_input_tokens",
  "get_session_output_tokens",
  "get_session_cache_read_tokens",
  "get_session_cache_write_tokens",
  "read_updated_at",
]);

const NUMERIC = new Set([
  "requests",
  "input_tokens",
  "output_tokens",
  "thinking_tokens",
  "cache_read_tokens",
  "cache_write_5m_tokens",
  "cache_write_1h_tokens",
  "cache_write_unsplit_tokens",
  "web_search_requests",
  "unfinished_requests",
  "cost_usd",
  "run_from_cost_usd",
  "run_total_usd",
  "result_total_cost_usd",
  "result_segments",
  "model_usage_total_usd",
  "get_session_cost_usd",
  "get_session_input_tokens",
  "get_session_output_tokens",
  "get_session_cache_read_tokens",
  "get_session_cache_write_tokens",
]);

const base = (session, source) => ({
  session_id: session.id,
  session_created_at: session.created_at ?? "",
  environment: session.environment ?? "",
  source,
});

/** The payload of a result event, which list_events wraps in `internal_anthropic_catchall`. */
const resultBody = (ev) => ev?.result?.internal_anthropic_catchall ?? ev?.result ?? null;

/** The newest result event on a list_events page, by created_at; null when there is none. */
export function lastResult(events) {
  let best = null;
  for (const ev of events ?? []) {
    if (!ev?.result) continue;
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  return best;
}

/** Timestamps compared as instants, so `…:29Z` sorts before `…:29.5Z`; ties fall back to text. */
export function cmpTime(a, b) {
  const [x, y] = [Date.parse(a ?? ""), Date.parse(b ?? "")];
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x < y ? -1 : 1;
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

const totalOf = (ev) => {
  const t = resultBody(ev)?.total_cost_usd;
  return typeof t === "number" ? t : undefined;
};

/**
 * The runs of a session's cumulative modelUsage counter in its result events. A resumed CLI
 * normally restores the counter, but a process that does not starts it again from zero, so a
 * drop in `total_cost_usd` ends a run. Each run's last reading is its whole cost. A restarted run
 * that has already passed the old total by its first result leaves no drop and is missed; the
 * get_session residual (`finalize`) books what that loses. A result with no total neither ends
 * nor starts a run, and a run's end is its newest result that has a total, when one does. A
 * result repeated across overlapping pages sorts beside its twin and changes nothing.
 */
export function sessionUsage(events) {
  const results = (events ?? [])
    .filter((ev) => ev?.result)
    .sort((a, b) => cmpTime(a.created_at, b.created_at));
  if (!results.length) return null;
  const runs = [];
  let run = null;
  let lastTotal;
  for (const ev of results) {
    const t = totalOf(ev);
    if (run && t !== undefined && lastTotal !== undefined && t < lastTotal) run = null;
    if (!run) {
      run = { from: ev.created_at, fromTotal: undefined, end: ev };
      runs.push(run);
    }
    if (t !== undefined || totalOf(run.end) === undefined) run.end = ev;
    if (t !== undefined) {
      lastTotal = t;
      if (run.fromTotal === undefined) run.fromTotal = t;
    }
  }
  return {
    runs,
    segments: runs.length,
    total: runs.reduce((n, r) => n + (totalOf(r.end) ?? 0), 0),
    as_of: results.at(-1).created_at,
    last: results.at(-1),
  };
}

/**
 * One row per model from a result event's cumulative `modelUsage`. That map counts subagents and
 * tool-internal calls (WebSearch runs on Haiku), so it is the bill by model only. The cache-write
 * TTL split is often absent or partial: what it does not account for goes to
 * `cache_write_unsplit_tokens`, never guessed into a TTL. `model_usage_since_last_result` is the
 * last turn alone and is never read here.
 */
export function modelUsageRows(session, ev, run = { from: ev.created_at }) {
  const body = resultBody(ev);
  const rows = [];
  for (const [model, u] of Object.entries(body?.modelUsage ?? {})) {
    const cw = u.cacheCreationInputTokens ?? 0;
    const cw1h = u.cacheCreationEphemeral1hInputTokens ?? 0;
    const cw5m = u.cacheCreationEphemeral5mInputTokens ?? 0;
    rows.push({
      ...base(session, "modelUsage"),
      agent_id: "(all)",
      agent_type: "",
      effort: "",
      model,
      requests: "",
      input_tokens: u.inputTokens ?? 0,
      output_tokens: u.outputTokens ?? 0,
      thinking_tokens: u.thinkingTokens ?? 0,
      cache_read_tokens: u.cacheReadInputTokens ?? 0,
      cache_write_5m_tokens: cw5m,
      cache_write_1h_tokens: cw1h,
      cache_write_unsplit_tokens: Math.max(0, cw - cw5m - cw1h),
      web_search_requests: u.webSearchRequests ?? 0,
      unfinished_requests: "",
      cost_usd: u.costUSD ?? 0,
      cost_basis: u.costBasis ?? "unstated",
      run_from: run.from,
      run_from_cost_usd: run.fromTotal ?? totalOf(ev) ?? "",
      run_total_usd: totalOf(ev) ?? "",
      as_of: ev.created_at,
    });
  }
  return rows;
}

function addRecord(row, r) {
  row.requests++;
  row.input_tokens += r.usage.in;
  row.output_tokens += r.usage.out;
  row.thinking_tokens += r.thinking;
  row.cache_read_tokens += r.usage.cr;
  row.cache_write_5m_tokens += r.usage.cw5m;
  row.cache_write_1h_tokens += r.usage.cw1h;
  row.web_search_requests += r.webSearch;
  if (r.unfinished) row.unfinished_requests++;
  const { cost } = priceRequest(r.model, r.usage);
  if (cost === null) row.cost_basis = "unpriced";
  else row.cost_usd += cost;
}

const agentRow = (session, source, agent_id, agent_type, effort, model, as_of) => ({
  ...base(session, source),
  agent_id,
  agent_type,
  effort,
  model,
  requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  thinking_tokens: 0,
  cache_read_tokens: 0,
  cache_write_5m_tokens: 0,
  cache_write_1h_tokens: 0,
  // ledger.mjs counts and prices a write with no TTL split at the 5-minute rate (#1435).
  cache_write_unsplit_tokens: "",
  web_search_requests: 0,
  unfinished_requests: 0,
  cost_usd: 0,
  cost_basis: `list-computed (${PRICE_SOURCE})`,
  run_from: "",
  run_from_cost_usd: "",
  run_total_usd: "",
  as_of,
});

/** Records from transcript lines, deduplicated by message.id as `ledger.mjs` does (#1435). */
function records(text, { skipSidechain = false } = {}) {
  const lines = [];
  const extra = new Map();
  for (const line of splitLines(text)) {
    if (!line.includes('"usage"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (skipSidechain && (o.isSidechain || o.parent_tool_use_id)) continue;
    const u = o?.message?.usage;
    if (o?.message?.id && u) {
      extra.set(o.message.id, {
        thinking: u.output_tokens_details?.thinking_tokens ?? 0,
        webSearch: u.server_tool_use?.web_search_requests ?? 0,
      });
    }
    lines.push(line);
  }
  return usageRecords(lines).records.map((r) => ({ ...r, ...(extra.get(r.id) ?? {}) }));
}

function groupInto(rows, key, make, r) {
  if (!rows.has(key)) rows.set(key, make());
  addRecord(rows.get(key), r);
}

/**
 * Rows per agent and model from one session's transcripts: `main` is the session's own JSONL,
 * `agents` each subagent's JSONL with its `.meta.json`. A subagent's lines that the main file
 * also carries (`isSidechain`) are counted from the agent's own file, never on the main thread.
 */
export function transcriptRows(session, { main, agents }, as_of = "") {
  const rows = new Map();
  const seen = new Set();
  for (const r of records(main ?? "", { skipSidechain: true })) {
    seen.add(r.id);
    groupInto(
      rows,
      `main\u0000${r.model}\u0000${r.effort}`,
      () => agentRow(session, "transcript", "main", "main", r.effort, r.model, as_of),
      r,
    );
  }
  for (const a of agents ?? []) {
    const type = a.meta?.agentType ?? "(unknown)";
    for (const r of records(a.text ?? "")) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const effort = r.effort === "(unset)" ? (a.meta?.effort ?? "(unset)") : r.effort;
      groupInto(
        rows,
        `${a.id}\u0000${r.model}\u0000${effort}`,
        () => agentRow(session, "transcript", a.id, type, effort, r.model, as_of),
        r,
      );
    }
  }
  return [...rows.values()];
}

/**
 * Rows per agent and model from a session's server `assistant` events. A message whose
 * `parent_tool_use_id` is set belongs to the agent that tool call started, never to the main
 * thread. Probe (a), 2026-10-27: the server receives none of a subagent's own messages, so in
 * practice this yields the main thread only; the split is kept for the day it does.
 */
export function assistantEventRows(session, events) {
  const lines = [];
  const owner = new Map();
  let as_of = "";
  for (const ev of events ?? []) {
    const body = ev?.assistant?.internal_anthropic_catchall ?? ev?.assistant;
    const m = body?.message;
    if (!m?.id || !m.usage) continue;
    owner.set(m.id, body.parent_tool_use_id || "main");
    if (ev.created_at > as_of) as_of = ev.created_at;
    lines.push(JSON.stringify({ message: m }));
  }
  const rows = new Map();
  for (const r of records(lines.join("\n"))) {
    const agent = owner.get(r.id);
    groupInto(
      rows,
      `${agent}\u0000${r.model}`,
      () =>
        agentRow(
          session,
          "assistant-events",
          agent,
          agent === "main" ? "main" : "(unknown)",
          "",
          r.model,
          as_of,
        ),
      r,
    );
  }
  return [...rows.values()];
}

/** Reads one session's transcript tree: `<dir>/<id>.jsonl` and `<dir>/<id>/subagents/**`. */
export function readSessionTranscripts(dir, cliSessionId) {
  const main = readFileSync(join(dir, `${cliSessionId}.jsonl`), "utf8");
  const agents = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^agent-.*\.jsonl$/.test(e.name)) {
        const metaPath = p.replace(/\.jsonl$/, ".meta.json");
        let meta = {};
        try {
          if (existsSync(metaPath)) meta = JSON.parse(readFileSync(metaPath, "utf8"));
        } catch {
          // A malformed .meta.json leaves the agent's type and effort unknown; the rows still count.
        }
        agents.push({ id: basename(p, ".jsonl"), meta, text: readFileSync(p, "utf8") });
      }
    }
  };
  walk(join(dir, cliSessionId, "subagents"));
  agents.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { main, agents };
}

/**
 * The ledger's session ID for a transcript: `--id` if given; for this container's own session
 * (its uuid is `CLAUDE_CODE_SESSION_ID`), the cloud ID from `CLAUDE_CODE_REMOTE_SESSION_ID`,
 * `cse_X` becoming `session_X`; otherwise the transcript's uuid.
 */
export function transcriptId(uuid, env, { id, all } = {}) {
  if (id) return id;
  const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (!all && remote && uuid === env.CLAUDE_CODE_SESSION_ID)
    return remote.replace(/^cse_/, "session_");
  return uuid;
}

// ---- remote-sessions MCP results, harvested from Claude Code transcripts ----

const TOOL = "mcp__claude-code-remote__";

function textOf(content) {
  return Array.isArray(content)
    ? content.map((b) => b?.text ?? "").join("")
    : String(content ?? "");
}

/** The `{"ccr": …}` object in a tool result, scanning past the untrusted-data envelope. */
export function ccrPayload(text) {
  const pointer = text.includes('{"ccr"')
    ? null
    : text.match(/saved to:? (\/\S+?\.(?:txt|json))\b/);
  if (pointer) {
    let saved = readFileSync(pointer[1], "utf8");
    if (saved.startsWith("[")) saved = textOf(JSON.parse(saved));
    text = saved;
  }
  const start = text.indexOf('{"ccr"');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1)).ccr;
  }
  throw new Error("unterminated ccr payload");
}

function jsonlFiles(d, out = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) jsonlFiles(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out.sort();
}

/**
 * Every claude-code-remote MCP call under a transcript root (`~/.claude/projects`), main threads
 * and subagents, with its input and parsed payload. A result the harness persisted to a file is
 * read from that file.
 */
export function mcpCalls(root) {
  const out = [];
  for (const file of jsonlFiles(root)) {
    const uses = new Map();
    for (const line of splitLines(readFileSync(file, "utf8"))) {
      if (!line.includes(TOOL) && !line.includes("tool_result")) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const content = o?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type === "tool_use" && b.name?.startsWith(TOOL)) uses.set(b.id, b);
        else if (b?.type === "tool_result" && uses.has(b.tool_use_id)) {
          const use = uses.get(b.tool_use_id);
          let payload;
          try {
            payload = ccrPayload(textOf(b.content));
          } catch (e) {
            payload = { error: String(e) };
          }
          out.push({ tool: use.name.slice(TOOL.length), input: use.input ?? {}, payload, file });
        }
      }
    }
  }
  return out;
}

/** Each session's newest `list_sessions` row, by `updated_at`, across every page read. */
export function listedSessions(calls) {
  const listed = new Map();
  for (const c of calls) {
    if (c.tool !== "list_sessions" || !c.payload || c.payload.error) continue;
    for (const s of c.payload.data ?? []) {
      const old = listed.get(s.id);
      if (!old || cmpTime(s.updated_at, old.updated_at) >= 0) listed.set(s.id, s);
    }
  }
  return [...listed.values()];
}

/**
 * Whether a session's list_events pages hold its whole history: the chain read backwards from
 * its newest cursorless page over result events, each `before_id` the previous page's
 * `first_id`, ends on a page with no `has_more`. An `after_id` page's has_more is about newer
 * events, a kinds filter without "result" says nothing about results, and an older poll's
 * complete-looking page says nothing about what came after it.
 */
function historyComplete(pages) {
  const ok = pages.filter((p) => {
    const kinds = p.input.kinds;
    return (!Array.isArray(kinds) || kinds.includes("result")) && !p.input.after_id;
  });
  const newestOf = (p) =>
    (p.payload.data ?? []).reduce((m, e) => (cmpTime(e.created_at, m) > 0 ? e.created_at : m), "");
  const heads = ok.filter((p) => !p.input.before_id);
  if (!heads.length) return false;
  let page = heads.reduce((a, b) => (cmpTime(newestOf(b), newestOf(a)) >= 0 ? b : a));
  for (let hops = 0; hops <= ok.length; hops++) {
    if (page.payload.has_more !== true) return true;
    const next = ok.find((p) => p.input.before_id && p.input.before_id === page.payload.first_id);
    if (!next) return false;
    page = next;
  }
  return false;
}

/** Ledger rows (one per run of the counter per model) and a sessions table from MCP calls. */
export function backfill(calls) {
  const listed = new Map(listedSessions(calls).map((s) => [s.id, s]));
  const got = new Map();
  const pages = new Map();
  for (const c of calls) {
    const p = c.payload;
    if (!p || p.error) continue;
    if (c.tool === "get_session" && p.id) {
      const old = got.get(p.id);
      if (!old || cmpTime(p.updated_at, old.updated_at) >= 0) got.set(p.id, p);
    } else if (c.tool === "list_events" && c.input.session_id) {
      const sid = c.input.session_id;
      if (!pages.has(sid)) pages.set(sid, []);
      pages.get(sid).push(c);
    }
  }
  const rows = [];
  const sessions = [];
  const ids = new Set([...listed.keys(), ...got.keys(), ...pages.keys()]);
  for (const id of [...ids].sort()) {
    const meta = { ...(listed.get(id) ?? {}), ...(got.get(id) ?? {}) };
    const session = { id, created_at: meta.created_at, environment: meta.environment_kind };
    const read = pages.get(id) ?? [];
    const su = sessionUsage(read.flatMap((c) => c.payload.data ?? []));
    const history = !read.length ? "" : historyComplete(read) ? "complete" : "newest-page";
    const mine = [];
    for (const run of su?.runs ?? []) mine.push(...modelUsageRows(session, run.end, run));
    for (const r of mine) r.history = history;
    rows.push(...mine);
    const usage = got.get(id)?.external_metadata?.usage;
    let coverage = "not-read";
    if (mine.length) coverage = "modelUsage";
    else if (su) coverage = "no-server-usage";
    else if (read.length) coverage = "no-result";
    sessions.push({
      session_id: id,
      created_at: meta.created_at ?? "",
      updated_at: meta.updated_at ?? "",
      title: meta.title ?? "",
      origin: meta.origin ?? "",
      environment: meta.environment_kind ?? "",
      status: meta.session_status ?? "",
      coverage: read.length ? coverage : "",
      history,
      as_of: su?.as_of ?? "",
      result_segments: su?.segments ?? "",
      result_total_cost_usd: totalOf(su?.last) ?? "",
      model_usage_total_usd: su ? su.total : "",
      get_session_cost_usd: usage?.cost_usd ?? "",
      get_session_input_tokens: usage?.input_tokens ?? "",
      get_session_output_tokens: usage?.output_tokens ?? "",
      get_session_cache_read_tokens: usage?.cache_read_tokens ?? "",
      get_session_cache_write_tokens: usage?.cache_write_tokens ?? "",
      read_updated_at: got.get(id)?.updated_at ?? "",
    });
  }
  return { rows, sessions };
}

const RANK = { complete: 2, "newest-page": 1 };
/** Whether reading `a` (as_of, history) should replace stored reading `b`. */
function newer(a, b) {
  const c = cmpTime(a.as_of, b.as_of);
  if (c) return c > 0;
  return (RANK[a.history] ?? 0) >= (RANK[b.history] ?? 0);
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const reading = (rows) => ({
  as_of: rows.reduce((m, r) => (cmpTime(r.as_of, m) > 0 ? r.as_of : m), ""),
  history: rows[0]?.history ?? "",
});
const runKey = (r) => `${r.run_from}\u0000${r.as_of}`;

/**
 * Merge new rows into stored ones; residual rows are not merged but rebuilt by `finalize`.
 * - `modelUsage`: an older reading, or an as-new and less full one, changes nothing. A newer
 *   reading replaces the stored runs it covers. A stored run is kept when the new reading is
 *   only the newest pages and the counter dropped between that run's end and the new pages'
 *   first result: it is an earlier run those pages did not reach.
 * - `transcript`: per agent, so a resumed container that lacks an earlier agent's file keeps it.
 * - any other source: per session, the newer reading wins.
 */
export function mergeRows(stored, incoming) {
  const family = (r) =>
    r.source === "transcript"
      ? `${r.session_id}\u0000transcript\u0000${r.agent_id}`
      : `${r.session_id}\u0000${r.source}`;
  const groups = groupBy(
    stored.filter((r) => r.source !== "get_session-residual"),
    family,
  );
  const fresh = groupBy(
    incoming.filter((r) => r.source !== "get_session-residual"),
    family,
  );
  for (const [k, rows] of fresh) {
    const old = groups.get(k);
    if (old && !newer(reading(rows), reading(old))) continue;
    let kept = [];
    if (old && rows[0].source === "modelUsage" && rows[0].history !== "complete") {
      const first = rows.reduce((a, r) => (cmpTime(r.run_from, a.run_from) < 0 ? r : a));
      const firstFloor = Number(
        first.run_from_cost_usd !== "" ? first.run_from_cost_usd : first.run_total_usd,
      );
      for (const run of groupBy(old, runKey).values()) {
        const r = run[0];
        if (cmpTime(r.as_of, first.run_from) < 0 && Number(r.run_total_usd) > firstFloor)
          kept.push(...run);
      }
    }
    groups.set(k, [...kept, ...rows]);
  }
  return [...groups.values()].flat();
}

const SESSION_USAGE = [
  "coverage",
  "history",
  "as_of",
  "result_segments",
  "result_total_cost_usd",
  "model_usage_total_usd",
];

/**
 * Merge a sessions table, one row per session. Its usage fields come from the newer reading (as
 * `mergeRows` judges it); its other fields from the newer listing or get_session (`updated_at`,
 * `read_updated_at`). A field a harvest left empty keeps its stored value.
 */
export function mergeSessions(stored, incoming) {
  const by = new Map(stored.map((s) => [s.session_id, s]));
  const pick = (a, b, takeB) =>
    takeB && b !== undefined && b !== "" ? b : a !== undefined && a !== "" ? a : (b ?? "");
  for (const s of incoming) {
    const old = by.get(s.session_id);
    if (!old) {
      by.set(s.session_id, s);
      continue;
    }
    const usageB = newer(
      { as_of: s.as_of || "", history: s.history },
      { as_of: old.as_of || "", history: old.history },
    );
    const metaB = cmpTime(s.updated_at, old.updated_at) >= 0;
    const readB = cmpTime(s.read_updated_at, old.read_updated_at) >= 0;
    const merged = {};
    for (const k of new Set([...Object.keys(old), ...Object.keys(s)])) {
      const takeB = SESSION_USAGE.includes(k)
        ? usageB
        : k.startsWith("get_session_") || k === "read_updated_at"
          ? readB
          : metaB;
      merged[k] = pick(old[k], s[k], takeB);
    }
    by.set(s.session_id, merged);
  }
  return [...by.values()].sort((a, b) => cmpTime(a.created_at, b.created_at));
}

/**
 * Rebuild what follows from the stored rows: each session's `model_usage_total_usd` and
 * `result_segments` from its stored runs, and its `get_session-residual` row. get_session's cost
 * is a floor (a process that dies mid-turn never reports its tail), so where it exceeds the
 * session's rows, a run is missing from them: one the pages read did not reach, or one that left
 * no drop to see. The difference is booked as one row, model `(unattributed)`. Built from stored
 * state, a harvest that read no get_session cannot drop it.
 */
export function finalize(rows, sessions) {
  const usage = rows.filter((r) => r.source !== "get_session-residual");
  const bySession = groupBy(
    usage.filter((r) => r.source === "modelUsage"),
    (r) => r.session_id,
  );
  const out = [...usage];
  const table = sessions.map((s) => {
    const mine = bySession.get(s.session_id) ?? [];
    const runs = [...groupBy(mine, runKey).values()];
    const next = { ...s, coverage: s.coverage || "not-read" };
    if (runs.length) {
      next.result_segments = runs.length;
      next.model_usage_total_usd = runs.reduce(
        (n, run) => n + Number(run[0].run_total_usd || 0),
        0,
      );
    }
    const sum = mine.reduce((n, r) => n + Number(r.cost_usd), 0);
    const floor = Number(s.get_session_cost_usd);
    if (s.get_session_cost_usd !== "" && Number.isFinite(floor) && floor - sum >= 0.01 - 1e-9) {
      out.push({
        session_id: s.session_id,
        session_created_at: s.created_at ?? "",
        environment: s.environment ?? "",
        source: "get_session-residual",
        agent_id: "(all)",
        agent_type: "",
        effort: "",
        model: "(unattributed)",
        cost_usd: floor - sum,
        cost_basis: "get_session usage.cost_usd less the modelUsage rows",
        as_of: s.as_of ?? "",
        history: s.history ?? "",
      });
    }
    return next;
  });
  return { rows: out, sessions: table };
}

/**
 * Each run's modelUsage rows must sum, within half a cent, to that run's `total_cost_usd`; a
 * session read with usage must have rows.
 */
export function reconcile(rows, sessions) {
  const runs = groupBy(
    rows.filter((r) => r.source === "modelUsage"),
    (r) => `${r.session_id}\u0000${runKey(r)}`,
  );
  const mismatches = [];
  const bad = new Set();
  for (const run of runs.values()) {
    const sum = run.reduce((n, r) => n + Number(r.cost_usd), 0);
    const total = Number(run[0].run_total_usd);
    if (run[0].run_total_usd === "" || Math.abs(sum - total) >= 0.005) {
      mismatches.push({ session_id: run[0].session_id, run: run[0].run_from, rows: sum, total });
      bad.add(run[0].session_id);
    }
  }
  const withRows = new Set([...runs.values()].map((run) => run[0].session_id));
  let n = 0;
  for (const s of sessions) {
    if (s.coverage !== "modelUsage") continue;
    n++;
    if (!withRows.has(s.session_id) && !bad.has(s.session_id))
      mismatches.push({
        session_id: s.session_id,
        run: "",
        rows: 0,
        total: Number(s.model_usage_total_usd),
      });
  }
  return { sessions: n, mismatches };
}

/**
 * Cloud sessions listed as updated since the get_session reading stored with them
 * (`read_updated_at`), or never read. Bridge (Remote Control) sessions are skipped: the server
 * holds no usage for them.
 */
export function staleSessions(listed, stored) {
  const seen = new Map(
    stored.filter((s) => s.read_updated_at).map((s) => [s.session_id, s.read_updated_at]),
  );
  return listed
    .filter((s) => s.environment_kind !== "bridge")
    .filter((s) => !seen.has(s.id) || cmpTime(s.updated_at, seen.get(s.id)) > 0)
    .map((s) => s.id);
}

// ---- CSV ----

const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, columns) {
  return (
    [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") +
    "\n"
  );
}

/** RFC 4180 parsing, character by character, so only a quoted field may hold a line break. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...body] = records;
  if (!header) return [];
  return body.map((r) =>
    Object.fromEntries(
      header.map((h, i) => {
        const v = r[i] ?? "";
        return [h, NUMERIC.has(h) && v !== "" ? Number(v) : v];
      }),
    ),
  );
}
