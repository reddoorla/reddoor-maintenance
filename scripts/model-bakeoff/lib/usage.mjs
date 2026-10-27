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
  "cost_read_at",
  "complete_through",
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

/** Timestamps compared as instants, so `…:29Z` sorts before `…:29.5Z`; ties fall back to text. */
export function cmpTime(a, b) {
  const [x, y] = [Date.parse(a ?? ""), Date.parse(b ?? "")];
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x < y ? -1 : 1;
  // Within one millisecond, compare the fractional seconds as digits, padded alike.
  const frac = (t) => ((t ?? "").match(/\.(\d+)/)?.[1] ?? "").padEnd(12, "0");
  if (Number.isFinite(x) && Number.isFinite(y))
    return frac(a) < frac(b) ? -1 : frac(a) > frac(b) ? 1 : 0;
  return (a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0;
}

const totalOf = (ev) => {
  const body = resultBody(ev);
  const t = body?.total_cost_usd;
  // An error result with no usage reads 0; it says nothing about the counter, so it is no total.
  if (t === 0 && !Object.keys(body?.modelUsage ?? {}).length) return undefined;
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
    .sort(
      (a, b) =>
        cmpTime(a.created_at, b.created_at) ||
        String(a.result.uuid ?? "").localeCompare(String(b.result.uuid ?? "")),
    );
  if (!results.length) return null;
  const runs = [];
  let run = null;
  let lastTotal;
  for (const ev of results) {
    const t = totalOf(ev);
    // A drop of less than half a cent is float noise, not a restart.
    if (run && t !== undefined && lastTotal !== undefined && t < lastTotal - 0.005) run = null;
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
  if (r.timestamp && cmpTime(r.timestamp, row.as_of) > 0) row.as_of = r.timestamp;
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
function records(text, { skipSidechain = false, sidechainOnly = false } = {}) {
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
    const side = Boolean(o.isSidechain || o.parent_tool_use_id);
    if ((skipSidechain && side) || (sidechainOnly && !side)) continue;
    const u = o?.message?.usage;
    if (o?.message?.id && u) {
      // The same rule as usageRecords: a stream-start line never replaces a finished one.
      const finished = o.message.stop_reason != null;
      if (finished || !extra.get(o.message.id)?.finished)
        extra.set(o.message.id, {
          finished,
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
 * One session's transcript messages, each owned by one agent: `main` is the session's own JSONL,
 * `agents` each subagent's JSONL with its `.meta.json`. A subagent's lines that the main file
 * also carries (`isSidechain`) are owned by the agent's own file; one with no agent file is kept
 * under agent `sidechain` rather than lost. They are what `usage/messages.jsonl` stores.
 */
export function transcriptMessages(session, { main, agents }) {
  const out = [];
  const seen = new Set();
  const add = (r, agent_id, agent_type, effort) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({
      message_id: r.id,
      session_id: session.id,
      session_created_at: session.created_at ?? "",
      environment: session.environment ?? "",
      agent_id,
      agent_type,
      effort,
      model: r.model,
      timestamp: r.timestamp ?? "",
      unfinished: r.unfinished,
      usage: r.usage,
      thinking: r.thinking ?? 0,
      webSearch: r.webSearch ?? 0,
    });
  };
  const inAgents = new Set((agents ?? []).flatMap((a) => records(a.text ?? "").map((r) => r.id)));
  for (const r of records(main ?? "", { sidechainOnly: true }))
    if (!inAgents.has(r.id)) add(r, "sidechain", "(unknown)", r.effort);
  for (const r of records(main ?? "", { skipSidechain: true })) add(r, "main", "main", r.effort);
  for (const a of agents ?? []) {
    const type = a.meta?.agentType ?? "(unknown)";
    for (const r of records(a.text ?? ""))
      add(r, a.id, type, r.effort === "(unset)" ? (a.meta?.effort ?? "(unset)") : r.effort);
  }
  return out;
}

/**
 * The union of stored and incoming transcript messages, one per `message.id`. A stored message
 * keeps its owner, so a message copied into another session's file (a fork, a resume) is never
 * counted twice, in any order of harvests; only a finished copy replaces an unfinished one.
 */
export function mergeMessages(stored, incoming) {
  const by = new Map();
  for (const m of [...stored, ...incoming]) {
    const old = by.get(m.message_id);
    if (!old || (old.unfinished && !m.unfinished))
      by.set(
        m.message_id,
        old
          ? {
              ...m,
              session_id: old.session_id,
              session_created_at: old.session_created_at,
              environment: old.environment,
              agent_id: old.agent_id,
              agent_type: old.agent_type,
            }
          : m,
      );
  }
  return [...by.values()].sort(
    (a, b) => cmpTime(a.timestamp, b.timestamp) || (a.message_id < b.message_id ? -1 : 1),
  );
}

/** Rows per session, agent, model and effort from transcript messages. */
export function messageRows(messages) {
  const rows = new Map();
  for (const m of messages) {
    const session = {
      id: m.session_id,
      created_at: m.session_created_at,
      environment: m.environment,
    };
    groupInto(
      rows,
      [m.session_id, m.agent_id, m.model, m.effort].join("\u0000"),
      () => agentRow(session, "transcript", m.agent_id, m.agent_type, m.effort, m.model, ""),
      { ...m, id: m.message_id },
    );
  }
  return [...rows.values()];
}

/**
 * Rows per agent and model from one session's transcripts (`transcriptMessages`, then
 * `messageRows`). A row's `as_of` is its newest message's timestamp. `seen` lets one call count
 * a message once across several sessions.
 */
export function transcriptRows(session, t, as_of = "", seen = new Set()) {
  const mine = transcriptMessages(session, t).filter((m) => !seen.has(m.message_id));
  for (const m of mine) seen.add(m.message_id);
  return messageRows(mine).map((r) => (as_of && !r.as_of ? { ...r, as_of } : r));
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
export function transcriptId(uuid, env, { id } = {}) {
  if (id) return id;
  const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (remote && uuid === env.CLAUDE_CODE_SESSION_ID) return remote.replace(/^cse_/, "session_");
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
  const pointer = text.match(/saved to:? ((?:\/|[A-Za-z]:\\).+?\.(?:txt|json))(?=[.\s]|$)/);
  const fromFile = () => {
    let saved = readFileSync(pointer[1], "utf8");
    if (saved.startsWith("[")) saved = textOf(JSON.parse(saved));
    return scanCcr(saved);
  };
  // An inline payload is read first: it may itself quote a "saved to" line from another
  // session's tool output. The pointer is followed when there is no inline payload, or when the
  // inline one is cut short, as a preview beside a pointer can be.
  if (!text.includes('{"ccr"')) {
    if (pointer && existsSync(pointer[1])) return fromFile();
    if (/saved to/.test(text))
      throw new Error("a persisted-output pointer this script cannot read");
    return null;
  }
  try {
    return scanCcr(text);
  } catch (e) {
    if (pointer && existsSync(pointer[1])) return fromFile();
    throw e;
  }
}

function scanCcr(text) {
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
          out.push({
            tool: use.name.slice(TOOL.length),
            input: use.input ?? {},
            payload,
            file,
            at: o.timestamp ?? "",
          });
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
 * Whether one harvest's list_events pages hold a session's whole history: the chain read
 * backwards from its newest cursorless page over result events (the one whose result arrived
 * last), each `before_id` the previous page's `first_id`, ends on a page with no `has_more`. An
 * `after_id` page's has_more is about newer events, a kinds filter without "result" says nothing
 * about results, and an older poll's complete-looking page says nothing about what came after it.
 */
function historyChain(pages) {
  const ok = pages.filter((p) => {
    const kinds = p.input.kinds;
    return (!Array.isArray(kinds) || kinds.includes("result")) && !p.input.after_id;
  });
  const heads = ok.filter((p) => !p.input.before_id);
  if (!heads.length) return null;
  let page = heads.reduce((a, b) => (cmpTime(b.at, a.at) >= 0 ? b : a));
  const chain = [page];
  for (let hops = 0; hops <= ok.length; hops++) {
    if (page.payload.has_more !== true) return chain;
    const next = ok.find((p) => p.input.before_id && p.input.before_id === page.payload.first_id);
    if (!next) return null;
    chain.push((page = next));
  }
  return null;
}

export function historyComplete(pages) {
  return historyChain(pages) !== null;
}

/**
 * The result events in a harvest's list_events pages, cut down to what the ledger is built from.
 * They are what `usage/results.jsonl` stores: merging two harvests is a union of these by
 * `uuid`, which no order of harvests can lose, and every server row is rebuilt from the union.
 */
export function resultRecords(calls) {
  const out = [];
  for (const c of calls) {
    if (c.tool !== "list_events" || !c.input.session_id || !c.payload || c.payload.error) continue;
    for (const ev of c.payload.data ?? []) {
      const body = resultBody(ev);
      if (!body) continue;
      out.push({
        session_id: c.input.session_id,
        uuid: ev.result.uuid ?? ev.created_at,
        created_at: ev.created_at,
        total_cost_usd: body.total_cost_usd ?? null,
        modelUsage: body.modelUsage ?? {},
      });
    }
  }
  return out;
}

/** The union of stored and incoming result records, one per session and uuid. */
export function mergeResults(stored, incoming) {
  const by = new Map();
  for (const r of [...stored, ...incoming]) by.set(`${r.session_id}\u0000${r.uuid}`, r);
  return [...by.values()].sort((a, b) =>
    a.session_id < b.session_id
      ? -1
      : a.session_id > b.session_id
        ? 1
        : cmpTime(a.created_at, b.created_at) || String(a.uuid).localeCompare(String(b.uuid)),
  );
}

const asEvent = (r) => ({
  created_at: r.created_at,
  result: {
    uuid: r.uuid,
    internal_anthropic_catchall: {
      total_cost_usd: r.total_cost_usd ?? undefined,
      modelUsage: r.modelUsage,
    },
  },
});

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/** One row per run of the counter per model, from every stored result of each session. */
export function serverRows(results, sessions) {
  const meta = new Map(sessions.map((s) => [s.session_id, s]));
  const rows = [];
  for (const [id, mine] of groupBy(results, (r) => r.session_id)) {
    const m = meta.get(id) ?? {};
    const session = { id, created_at: m.created_at, environment: m.environment };
    const su = sessionUsage(mine.map(asEvent));
    for (const run of su?.runs ?? [])
      for (const r of modelUsageRows(session, run.end, run))
        rows.push({ ...r, history: m.history ?? "" });
  }
  return rows;
}

const COVERAGE = { "": 0, "not-read": 0, "no-result": 1, "no-server-usage": 2, modelUsage: 3 };

/**
 * One harvest's sessions table. A session's fields come, one by one, from whichever of its
 * listing and its get_session reading is newer (`updated_at`); its usage figures from
 * get_session; `coverage`, `history` and `complete_through` from its list_events pages.
 */
export function harvestSessions(calls) {
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
      if (!pages.has(c.input.session_id)) pages.set(c.input.session_id, []);
      pages.get(c.input.session_id).push(c);
    }
  }
  const out = [];
  for (const id of [...new Set([...listed.keys(), ...got.keys(), ...pages.keys()])].sort()) {
    const l = listed.get(id) ?? {};
    const g = got.get(id) ?? {};
    const newerOf = (k) => {
      const lv = l[k];
      const gv = g[k];
      if (lv === undefined || lv === "") return gv ?? "";
      if (gv === undefined || gv === "") return lv;
      return cmpTime(g.updated_at, l.updated_at) >= 0 ? gv : lv;
    };
    const usage = g.external_metadata?.usage;
    const read = pages.get(id) ?? [];
    out.push({
      session_id: id,
      created_at: newerOf("created_at"),
      updated_at: newerOf("updated_at"),
      title: newerOf("title"),
      origin: newerOf("origin"),
      environment: newerOf("environment_kind"),
      status: newerOf("session_status"),
      coverage: read.length ? "no-result" : "",
      history: !read.length ? "" : historyComplete(read) ? "complete" : "newest-page",
      // The newest result on the chain that reached the start; other pages prove nothing.
      complete_through: (historyChain(read) ?? [])
        .flatMap((c) => (c.payload.data ?? []).filter((e) => e?.result))
        .reduce((m, e) => (cmpTime(e.created_at, m) > 0 ? e.created_at : m), ""),
      get_session_cost_usd: usage?.cost_usd ?? "",
      get_session_input_tokens: usage?.input_tokens ?? "",
      get_session_output_tokens: usage?.output_tokens ?? "",
      get_session_cache_read_tokens: usage?.cache_read_tokens ?? "",
      get_session_cache_write_tokens: usage?.cache_write_tokens ?? "",
      read_updated_at: g.updated_at ?? "",
      cost_read_at:
        usage?.cost_usd !== undefined && usage?.cost_usd !== null ? (g.updated_at ?? "") : "",
    });
  }
  return out;
}

const META = ["created_at", "updated_at", "title", "origin", "environment", "status"];
const READ = [
  "get_session_cost_usd",
  "get_session_input_tokens",
  "get_session_output_tokens",
  "get_session_cache_read_tokens",
  "get_session_cache_write_tokens",
  "cost_read_at",
];

/**
 * Merge sessions tables, one row per session. The listing fields are one group, taken whole from
 * the reading with the newer `updated_at`; the get_session figures another, taken whole from the
 * newer `read_updated_at`. A reading that lacks a group (no title, or no get_session cost) offers
 * nothing for it, so it can neither blank a field nor move that group's clock; then the result is
 * the same in any order of readings. `coverage` keeps the fullest seen, and `complete_through` the
 * newest complete read.
 */
export function mergeSessions(stored, incoming) {
  const by = new Map(stored.map((s) => [s.session_id, s]));
  const has = (v) => v !== undefined && v !== "";
  const group = (a, b, keys, offered, clock) => {
    const take = offered(b) && (!offered(a) || cmpTime(b[clock], a[clock]) > 0);
    const [win, lose] = take ? [b, a] : [a, b];
    return Object.fromEntries(keys.map((k) => [k, has(win[k]) ? win[k] : (lose[k] ?? "")]));
  };
  for (const s of incoming) {
    const old = by.get(s.session_id);
    if (!old) {
      by.set(s.session_id, { ...s });
      continue;
    }
    by.set(s.session_id, {
      ...old,
      ...s,
      ...group(old, s, META, (x) => has(x.title), "updated_at"),
      ...group(old, s, READ, (x) => has(x.get_session_cost_usd), "cost_read_at"),
      // The newest get_session reading of any kind, which `stale` compares with the listing.
      read_updated_at:
        cmpTime(s.read_updated_at, old.read_updated_at) > 0
          ? s.read_updated_at
          : (old.read_updated_at ?? ""),
      coverage:
        (COVERAGE[s.coverage] ?? 0) > (COVERAGE[old.coverage] ?? 0)
          ? s.coverage
          : (old.coverage ?? ""),
      // A harvest that read none of the session's events says nothing about its history.
      history: has(s.history) ? s.history : (old.history ?? ""),
      complete_through:
        cmpTime(s.complete_through, old.complete_through) > 0
          ? s.complete_through
          : (old.complete_through ?? ""),
    });
  }
  return [...by.values()].sort(
    (a, b) => cmpTime(a.created_at, b.created_at) || (a.session_id < b.session_id ? -1 : 1),
  );
}

/**
 * Merge non-server rows (transcript, assistant-events). Transcript rows merge per agent, so a
 * resumed container that lacks an earlier agent's file keeps its rows; within an agent, the
 * reading with the newer last message wins, or on a tie the one with more requests.
 */
export function mergeRows(stored, incoming) {
  const family = (r) =>
    r.source === "transcript"
      ? `${r.session_id}\u0000transcript\u0000${r.agent_id}`
      : `${r.session_id}\u0000${r.source}`;
  const local = (rows) =>
    rows.filter(
      (r) =>
        r.source !== "modelUsage" &&
        r.source !== "get_session-residual" &&
        r.source !== "transcript",
    );
  const groups = groupBy(local(stored), family);
  const size = (rows) => rows.reduce((n, r) => n + Number(r.requests || 0), 0);
  const last = (rows) => rows.reduce((m, r) => (cmpTime(r.as_of, m) > 0 ? r.as_of : m), "");
  for (const [k, rows] of groupBy(local(incoming), family)) {
    const old = groups.get(k);
    const c = old ? cmpTime(last(rows), last(old)) : 1;
    if (c > 0 || (c === 0 && size(rows) >= size(old))) groups.set(k, rows);
  }
  return [...groups.values()].flat();
}

const runKey = (r) => `${r.run_from}\u0000${r.as_of}`;

/**
 * What follows from the stored state: each session's `coverage`, `as_of`, `result_segments`,
 * `result_total_cost_usd` and `model_usage_total_usd` from its stored results, and its
 * `get_session-residual` row. get_session's cost is a floor (a process that dies mid-turn never
 * reports its tail), so where it exceeds the session's server rows a run is missing from them:
 * one no harvest's pages reached, or one that left no drop to see. The difference is booked as
 * one row, model `(unattributed)`.
 */
export function finalize(rows, sessions, results) {
  const bySession = groupBy(
    rows.filter((r) => r.source === "modelUsage"),
    (r) => r.session_id,
  );
  const stored = groupBy(results, (r) => r.session_id);
  const out = rows.filter((r) => r.source !== "get_session-residual");
  const table = sessions.map((s) => {
    const mine = bySession.get(s.session_id) ?? [];
    const su = sessionUsage((stored.get(s.session_id) ?? []).map(asEvent));
    const next = { ...s, coverage: s.coverage || "not-read" };
    if (s.history || s.complete_through)
      // Complete while no stored result is newer than the newest complete read.
      next.history =
        (s.complete_through && (!su || cmpTime(s.complete_through, su.as_of) >= 0)) ||
        (!su && s.history === "complete")
          ? "complete"
          : "newest-page";
    if (su) {
      next.coverage = mine.length ? "modelUsage" : "no-server-usage";
      next.as_of = su.as_of;
      next.result_segments = su.segments;
      next.result_total_cost_usd = totalOf(su.last) ?? "";
      next.model_usage_total_usd = su.total;
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
        as_of: next.as_of ?? "",
        history: s.history ?? "",
      });
    }
    return next;
  });
  // A server row's history is its session's, as finalized here.
  const history = new Map(table.map((s) => [s.session_id, s.history ?? ""]));
  for (const r of out)
    if (r.source === "modelUsage" || r.source === "get_session-residual")
      r.history = history.get(r.session_id) ?? "";
  return { rows: out, sessions: table };
}

/**
 * One harvest into the stored state. `calls` are its remote-sessions MCP results, `messages` its
 * transcript messages. Results and messages are unioned, sessions merged, and every server row,
 * transcript row and residual rebuilt from what is stored.
 */
export function ingest(store, { calls = [], messages = [], local = [] } = {}) {
  const results = mergeResults(store.results ?? [], resultRecords(calls));
  const stored = mergeMessages(store.messages ?? [], messages);
  const sessions = mergeSessions(store.sessions ?? [], harvestSessions(calls));
  const rows = [
    ...serverRows(results, sessions),
    ...messageRows(stored),
    ...mergeRows(store.rows ?? [], local),
  ];
  const done = finalize(rows, sessions, results);
  const SOURCE = { modelUsage: 0, "get_session-residual": 1, transcript: 2, "assistant-events": 3 };
  const order = (r) =>
    [
      r.session_created_at,
      r.session_id,
      SOURCE[r.source] ?? 9,
      r.agent_id,
      r.run_from,
      r.model,
      r.effort,
    ].join("\u0000");
  done.rows.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  return { results, messages: stored, rows: done.rows, sessions: done.sessions };
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
