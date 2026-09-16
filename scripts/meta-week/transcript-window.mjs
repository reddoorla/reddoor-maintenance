#!/usr/bin/env node
// Prints one session's transcript window as a compact chronological script, so a
// refuter can judge a census candidate without opening the raw file.
//
//   node scripts/meta-week/transcript-window.mjs --session ID --from ISO --to ISO
//     [--root DIR] [--max 400]
import { homedir } from "node:os";
import { join } from "node:path";
import { collectEvents } from "./lib/walk.mjs";
import { bySession } from "./lib/census.mjs";

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    session: "",
    from: "",
    to: "",
    max: 400,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--root":
        o.root = next();
        break;
      case "--session":
        o.session = next();
        break;
      case "--from":
        o.from = next();
        break;
      case "--to":
        o.to = next();
        break;
      case "--max":
        o.max = Number(next());
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!o.session || Number.isNaN(Date.parse(o.from)) || Number.isNaN(Date.parse(o.to))) {
    throw new Error("--session, --from and --to (ISO) are required");
  }
  return o;
}

const hms = (ts) => ts.slice(11, 19);
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root, { full: true });
  const from = Date.parse(o.from);
  const to = Date.parse(o.to);
  const inWin = (x) => {
    const t = Date.parse(x.ts);
    return t >= from && t <= to;
  };
  const lines = [];
  for (const p of (bySession(all.prompts).get(o.session) || []).filter(inWin)) {
    if (p.lane !== "main") continue;
    lines.push({ ts: p.ts, text: `USER ${clip(p.text, o.max)}` });
  }
  for (const t of all.tools.filter(
    (x) => x.sessionId === o.session && x.lane === "main" && inWin(x),
  )) {
    const what =
      t.file || t.command || (t.name === "Agent" ? `${t.agentType} ${clip(t.prompt, 80)}` : "");
    lines.push({ ts: t.ts, text: `[${t.name}] ${clip(what, o.max)}` });
  }
  // Assistant text needs the raw records: re-walk only this session's main files cheaply
  // by using the usage events' file list.
  const mainFiles = [
    ...new Set(
      all.usage.filter((e) => e.sessionId === o.session && e.lane === "main").map((e) => e.file),
    ),
  ];
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const seen = new Set();
  for (const file of mainFiles) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"type":"assistant"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type !== "assistant" || !inWin({ ts: rec.timestamp }) || seen.has(rec.uuid)) continue;
      seen.add(rec.uuid);
      const c = rec.message?.content;
      const text = Array.isArray(c)
        ? c
            .filter((b) => b && b.type === "text")
            .map((b) => String(b.text))
            .join(" ")
        : typeof c === "string"
          ? c
          : "";
      if (text.trim()) lines.push({ ts: rec.timestamp, text: `ASSISTANT ${clip(text, o.max)}` });
    }
  }
  // Subagent activity, one line per agent per window: its type, id and spend.
  const byAgent = new Map();
  for (const e of all.usage.filter(
    (x) => x.sessionId === o.session && x.lane === "subagent" && inWin(x),
  )) {
    const k = e.agentId || e.agent;
    const a = byAgent.get(k) || { ts: e.ts, agent: e.agent, id: e.agentId, out: 0, requests: 0 };
    a.out += e.out;
    a.requests += 1;
    if (e.ts < a.ts) a.ts = e.ts;
    byAgent.set(k, a);
  }
  for (const a of byAgent.values()) {
    lines.push({
      ts: a.ts,
      text: `[agent ${a.agent} ${a.id}] out=${a.out} requests=${a.requests}`,
    });
  }
  lines.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const l of lines) process.stdout.write(`${hms(l.ts)} ${l.text}\n`);
}

main().catch((e) => {
  process.stderr.write(`transcript-window: ${e.message}\n`);
  process.exit(1);
});
