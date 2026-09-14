// Streams every .jsonl under a Claude Code projects root and yields three kinds of
// event: deduplicated API usage, compaction boundaries, and account-limit blocks.
//
// Dedupe is by requestId, NOT uuid: one API response is written as several assistant
// records (one per content block), each carrying a partial output_tokens snapshot.
// The record with the largest output_tokens is the final one. Replayed history in
// resumed/compacted sessions repeats the same requestIds, so the same key covers it.
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";

const GITHUB_RE = /\/Documents\/GitHub\/([^/]+)/;
const BLOCK_RE = /^You've hit your (session|weekly) limit/i;

export async function* jsonlFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "memory") continue;
      yield* jsonlFiles(p);
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      yield p;
    }
  }
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

const SYSTEM_SHAPED = /^\s*(<task-notification>|<system-reminder>|<local-command-stdout>)/;
const INTERRUPT_RE = /^\s*\[Request interrupted/;

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
  let files = 0;
  let lines = 0;
  for await (const file of jsonlFiles(root)) {
    files++;
    const projectDir = projectDirOf(root, file);
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      lines++;
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
        if (rec.isMeta) continue;
        const text = promptText(rec.message);
        if (text === null || !text.trim()) continue;
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
  }
  return {
    usage: [...byKey.values()],
    compactions,
    blocks,
    prompts,
    tools,
    agentResults,
    interrupts,
    files,
    lines,
  };
}
