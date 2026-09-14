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

export async function collectEvents(root) {
  const byKey = new Map();
  const seenMarkers = new Set(); // uuids of compaction/block records already counted (replay)
  const compactions = [];
  const blocks = [];
  let files = 0;
  let lines = 0;
  for await (const file of jsonlFiles(root)) {
    files++;
    const projectDir = projectDirOf(root, file);
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      lines++;
      if (
        !line.includes('"usage"') &&
        !line.includes("compact_boundary") &&
        !line.includes("hit your")
      ) {
        continue;
      }
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
  return { usage: [...byKey.values()], compactions, blocks, files, lines };
}
