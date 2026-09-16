// Streams every .jsonl under a Claude Code projects root and yields three kinds of
// event: deduplicated API usage, compaction boundaries, and account-limit blocks.
//
// Dedupe is by requestId, NOT uuid: one API response is written as several assistant
// records (one per content block), each carrying a partial output_tokens snapshot.
// The record with the largest output_tokens is the final one. Replayed history in
// resumed/compacted sessions repeats the same requestIds, so the same key covers it.
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { createInterface } from "node:readline";

const GITHUB_RE = /\/Documents\/GitHub\/([^/]+)/;
const BLOCK_RE = /^You've hit your (session|weekly) limit/i;

export async function* jsonlFiles(root, keep) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "memory") continue;
      yield* jsonlFiles(p, keep);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      if (keep && !keep(p)) continue;
      yield p;
    }
  }
}

/**
 * The files one session writes, by PATH: `<project>/<sessionId>.jsonl` for the parent and
 * `<project>/<sessionId>/subagents/agent-<id>.jsonl` for each subagent. This is a
 * PREFILTER for speed — the corpus is 2.7 GB and a full walk reads all of it, which is
 * far too slow for a SessionStart hook — and it is not the filter of record: callers that
 * want one session still select on the records' own `sessionId`. Both agree on the real
 * layout (verified against 04ebfa83-654f-4fc7-a814-113f3f020dad, whose subagent records
 * carry the same id as the directory holding them).
 */
export function sessionFileFilter(sessionId) {
  if (!sessionId) return null;
  const file = `${sessionId}.jsonl`;
  return (p) => basename(p) === file || p.split(sep).includes(sessionId);
}

/** Repo name from cwd; falls back to the project directory name with worktree suffixes stripped. */
export function repoOf(rec, projectDir) {
  const m = typeof rec.cwd === "string" ? GITHUB_RE.exec(rec.cwd) : null;
  if (m) return m[1];
  return projectDir.replace(/^.*-GitHub-/, "").replace(/--(claude-)?worktrees-.*$/, "");
}

function projectDirOf(root, file) {
  return file.slice(root.length + 1).split(sep)[0];
}

function firstText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const t = c.find((b) => b && b.type === "text");
    return t ? String(t.text) : "";
  }
  return "";
}

const num = (v) => (Number.isFinite(v) ? v : 0);

// Records the HARNESS writes as `type: "user"` that carry no operator turn at all. The
// last two were found on the first real census run (2026-09-14): the summarisation
// request quotes the transcript it is summarising, and the compaction continuation quotes
// its own summary, so both matched stop and correction phrases the operator never typed.
const SYSTEM_SHAPED =
  /^\s*(<task-notification>|<system-reminder>|<local-command-stdout>|Context: This summary will be shown in a list|This session is being continued from a previous conversation)/;
const INTERRUPT_RE = /^\s*\[Request interrupted/;

// A subagent's own transcript: <project>/<sessionId>/subagents/agent-<agentId>.jsonl,
// with a sibling agent-<agentId>.meta.json holding {agentType, description, toolUseId,
// spawnDepth}. toolUseId is the id of the parent's Agent tool_use block.
const SUBAGENT_RE = /([^/\\]+)[/\\]subagents[/\\]agent-([^/\\]+)\.jsonl$/;

// The harness writes a <task-notification> into the PARENT when an async dispatch ends.
// <task-id> is the agentId for an Agent dispatch and an opaque id for a background Bash
// command, so the join is by id and the non-agent ids simply never match.
const TASK_ID_RE = /<task-id>([^<]+)<\/task-id>/;
const TASK_STATUS_RE = /<status>([^<]+)<\/status>/;

function taskNotification(text) {
  if (!text || !text.includes("<task-notification>")) return null;
  const id = TASK_ID_RE.exec(text);
  if (!id) return null;
  const st = TASK_STATUS_RE.exec(text);
  return { agentId: id[1].trim(), status: st ? st[1].trim() : "" };
}

/**
 * How a subagent transcript ENDS, from its last record. Four states, of which only the
 * first two are an explicit record that the agent was killed:
 *
 *   "quota-rejected"  the last record is an assistant turn whose quotaLimits.status is
 *                     "rejected" — the account limit answered instead of the model, with
 *                     all-zero usage and the "You've hit your … limit" text.
 *   "interrupted"     the last record is a `user` record reading "[Request interrupted…]":
 *                     the agent was cut off and never wrote another turn.
 *   "ok"              a finished assistant turn (it carries a text block).
 *   "unterminated"    anything else — a file that stops mid tool_use or mid thinking.
 *                     This is NOT a kill: it is the same picture an agent still IN FLIGHT
 *                     writes, and on 2026-09-14 the only two in the corpus belonged to the
 *                     live session that wrote this walker. The census does not nominate it.
 */
export function agentEndState(rec) {
  if (!rec) return "empty";
  if (rec.type === "assistant") {
    if (rec.quotaLimits && rec.quotaLimits.status === "rejected") return "quota-rejected";
    const c = rec.message && rec.message.content;
    const hasText = Array.isArray(c)
      ? c.some((b) => b && b.type === "text")
      : typeof c === "string" && c.trim().length > 0;
    return hasText ? "ok" : "unterminated";
  }
  if (rec.type === "user" && INTERRUPT_RE.test(firstText(rec.message))) return "interrupted";
  return "unterminated";
}

// The IDE writes a preamble onto the operator's OWN turn — the opened file or the
// selected lines, then the operator's text. It is not a system record: of the 140
// preamble-carrying prompts in the corpus (probe, 2026-09-14) every one had a real turn
// after the preamble, and not one had a stop or correction phrase inside the preamble. So
// strip the preamble and keep the turn; a record that is nothing but preamble is dropped
// by the empty-text check below. Preambles stack, hence the loop.
const IDE_PREAMBLE = /^\s*<(ide_opened_file|ide_selection)>[\s\S]*?<\/\1>\s*/;

export function stripIdePreamble(text) {
  let t = text;
  for (;;) {
    const next = t.replace(IDE_PREAMBLE, "");
    if (next === t) return t;
    t = next;
  }
}

function promptText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === "tool_result")) return null;
    return c
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text))
      .join("\n");
  }
  return null;
}

export async function collectEvents(root, opts = {}) {
  const full = !!opts.full;
  const keep = sessionFileFilter(opts.sessionId || "");
  const byKey = new Map();
  const seenMarkers = new Set(); // uuids of compaction/block records already counted (replay)
  const seenTools = new Set();
  const seenResults = new Set();
  const compactions = [];
  const blocks = [];
  const prompts = [];
  const tools = [];
  const agentResults = [];
  const interrupts = [];
  const agents = [];
  const notifications = [];
  const seenAgents = new Set();
  const seenNotifications = new Set();
  let files = 0;
  let lines = 0;
  for await (const file of jsonlFiles(root, keep)) {
    files++;
    const projectDir = projectDirOf(root, file);
    const sub = full ? SUBAGENT_RE.exec(file) : null;
    let firstLine = "";
    let lastLine = "";
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      lines++;
      if (sub && line.trim()) {
        if (!firstLine) firstLine = line;
        lastLine = line;
      }
      const interesting =
        line.includes('"usage"') ||
        line.includes("compact_boundary") ||
        line.includes("hit your") ||
        (full && line.includes('"type":"user"'));
      if (!interesting) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type === "system" && rec.subtype === "compact_boundary") {
        if (rec.uuid && seenMarkers.has(rec.uuid)) continue;
        if (rec.uuid) seenMarkers.add(rec.uuid);
        const meta = rec.compactMetadata || {};
        compactions.push({
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
          trigger: meta.trigger || "unknown",
          preTokens: num(meta.preTokens),
        });
        continue;
      }
      if (full && rec.type === "user" && rec.message) {
        const base = {
          uuid: rec.uuid,
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
        };
        const tr = rec.toolUseResult;
        if (tr && typeof tr === "object" && tr.agentId) {
          const c = rec.message.content;
          const toolUseId = Array.isArray(c) && c[0] && c[0].tool_use_id ? c[0].tool_use_id : "";
          const rkey = toolUseId || tr.agentId;
          if (!seenResults.has(rkey)) {
            seenResults.add(rkey);
            agentResults.push({
              ...base,
              toolUseId,
              agentId: tr.agentId,
              status: tr.status || "",
              totalTokens: num(tr.totalTokens),
            });
          }
          continue;
        }
        // A completion notice for an async dispatch. Collected and then FALLEN THROUGH:
        // the record still reaches SYSTEM_SHAPED below, which is what drops it from the
        // prompts, so adding this changes no existing count.
        if (line.includes("<task-notification>")) {
          const notif = taskNotification(firstText(rec.message));
          if (notif) {
            const nkey = base.sessionId + " " + notif.agentId + " " + notif.status;
            if (!seenNotifications.has(nkey)) {
              seenNotifications.add(nkey);
              notifications.push({ ...base, agentId: notif.agentId, status: notif.status });
            }
          }
        }
        if (rec.isMeta) continue;
        const raw = promptText(rec.message);
        if (raw === null) continue;
        const text = stripIdePreamble(raw);
        if (!text.trim()) continue;
        if (rec.uuid && seenMarkers.has(rec.uuid)) continue;
        if (rec.uuid) seenMarkers.add(rec.uuid);
        if (INTERRUPT_RE.test(text)) {
          interrupts.push({ ...base, text: text.slice(0, 200) });
          continue;
        }
        if (SYSTEM_SHAPED.test(text)) continue;
        prompts.push({
          ...base,
          text: text.slice(0, 500),
          command: text.includes("<command-name>"),
        });
        continue;
      }
      if (rec.type !== "assistant" || !rec.message) continue;
      const text = firstText(rec.message);
      if (BLOCK_RE.test(text) && !(rec.uuid && seenMarkers.has(rec.uuid))) {
        if (rec.uuid) seenMarkers.add(rec.uuid);
        blocks.push({
          ts: rec.timestamp,
          sessionId: rec.sessionId || "",
          repo: repoOf(rec, projectDir),
          lane: rec.isSidechain ? "subagent" : "main",
          kind: /weekly/i.test(text) ? "weekly" : "session",
          text,
        });
      }
      if (full && Array.isArray(rec.message.content)) {
        for (const b of rec.message.content) {
          if (!b || b.type !== "tool_use" || !b.id || seenTools.has(b.id)) continue;
          seenTools.add(b.id);
          const input = b.input || {};
          tools.push({
            id: b.id,
            name: b.name || "",
            ts: rec.timestamp,
            sessionId: rec.sessionId || "",
            repo: repoOf(rec, projectDir),
            lane: rec.isSidechain ? "subagent" : "main",
            requestId: rec.requestId || "",
            file: typeof input.file_path === "string" ? input.file_path : "",
            agentType: typeof input.subagent_type === "string" ? input.subagent_type : "",
            agentModel: typeof input.model === "string" ? input.model : "",
            background: !!input.run_in_background,
            prompt: typeof input.prompt === "string" ? input.prompt.slice(0, 300) : "",
            command: typeof input.command === "string" ? input.command.slice(0, 120) : "",
          });
        }
      }
      const u = rec.message.usage;
      if (!u) continue;
      const model = rec.message.model || "";
      if (!model || model === "<synthetic>") continue;
      const key = rec.requestId || rec.uuid;
      if (!key) continue;
      const ev = {
        key,
        uuid: rec.uuid,
        ts: rec.timestamp,
        repo: repoOf(rec, projectDir),
        sessionId: rec.sessionId || "",
        lane: rec.isSidechain ? "subagent" : "main",
        agentId: rec.agentId || "",
        agent: rec.attributionAgent || (rec.isSidechain ? "subagent:unknown" : "main"),
        model,
        effort: rec.effort || "",
        skill: rec.attributionSkill || "",
        in: num(u.input_tokens),
        out: num(u.output_tokens),
        cacheCreate: num(u.cache_creation_input_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        file,
      };
      if (ev.in + ev.out + ev.cacheCreate + ev.cacheRead === 0) continue;
      const prev = byKey.get(key);
      if (!prev || ev.out > prev.out || (ev.out === prev.out && ev.ts > prev.ts))
        byKey.set(key, ev);
    }
    if (sub) await pushAgent(agents, seenAgents, file, projectDir, sub, firstLine, lastLine);
  }
  return {
    usage: [...byKey.values()],
    compactions,
    blocks,
    prompts,
    tools,
    agentResults,
    interrupts,
    agents,
    notifications,
    files,
    lines,
  };
}

function parseOrNull(line) {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * One row per subagent transcript. The same session can be written under two project
 * directories (the corpus carries -GitHub-Broken and -GitHub-Broken-broken), so rows are
 * deduped by agentId. sessionId comes from the records themselves and falls back to the
 * directory the file sits in.
 */
async function pushAgent(agents, seen, file, projectDir, match, firstLine, lastLine) {
  const agentId = match[2];
  if (seen.has(agentId)) return;
  seen.add(agentId);
  const first = parseOrNull(firstLine);
  const last = parseOrNull(lastLine);
  const src = first || last;
  let meta;
  try {
    meta = JSON.parse(await readFile(file.replace(/\.jsonl$/, ".meta.json"), "utf-8"));
  } catch {
    // an older transcript may have no sibling meta.json; the row still carries its usage
    meta = {};
  }
  agents.push({
    agentId,
    sessionId: (src && src.sessionId) || match[1],
    repo: src ? repoOf(src, projectDir) : projectDir.replace(/^.*-GitHub-/, ""),
    agentType: typeof meta.agentType === "string" ? meta.agentType : "",
    description: typeof meta.description === "string" ? meta.description : "",
    toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : "",
    spawnDepth: Number.isFinite(meta.spawnDepth) ? meta.spawnDepth : 0,
    spawnedAt: (first && first.timestamp) || "",
    lastAt: (last && last.timestamp) || "",
    lastStatus: agentEndState(last),
    file,
  });
}
