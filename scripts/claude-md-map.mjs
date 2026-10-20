#!/usr/bin/env node
import { readFileSync } from "node:fs";

const USAGE = "usage: node scripts/claude-md-map.mjs --source <CLAUDE.md> --map <map.md>";
const KINDS = /^(H|B|R): (.+)$/;
const DESTS = /^(kept|moved|dropped|operator:)/;

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source" || a === "--map") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      o[a.slice(2)] = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.source || !o.map) throw new Error(USAGE);
  return o;
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();

export function sourceItems(text) {
  const out = [];
  let inFence = false;
  let para = null;
  const flush = () => {
    if (para === null) return;
    const m = /^\*\*([\s\S]+?)\*\*/.exec(para);
    if (m) out.push(`B: ${collapse(m[1])}`);
    para = null;
  };
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,3} /.test(line)) {
      flush();
      out.push(`H: ${collapse(line.replace(/^#+ /, ""))}`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flush();
      para = item[1];
    } else if (para === null) para = line.trim();
    else para += ` ${line.trim()}`;
  }
  flush();
  return out;
}

export function mapRows(text) {
  const rows = [];
  text.split("\n").forEach((line, i) => {
    if (!/^\|/.test(line)) return;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    const m = KINDS.exec(cells[1] ?? "");
    if (!m) return;
    rows.push({ line: i + 1, key: `${m[1]}: ${collapse(m[2])}`, dest: cells[2] ?? "" });
  });
  return rows;
}

export function check(sourceText, mapText) {
  const items = sourceItems(sourceText);
  const rows = mapRows(mapText);
  const keys = new Set(rows.map((r) => r.key));
  const wanted = new Set(items);
  const problems = [];
  for (const it of items) if (!keys.has(it)) problems.push(`unmapped ${it}`);
  for (const r of rows) {
    if (r.key.startsWith("R: ")) continue;
    if (!wanted.has(r.key)) problems.push(`stale map:${r.line} ${r.key}`);
  }
  for (const r of rows)
    if (!DESTS.test(r.dest)) problems.push(`no destination map:${r.line} ${r.key}`);
  const unmapped = problems.filter((p) => p.startsWith("unmapped")).length;
  const summary = `claude-md-map: source=${items.length} rows=${rows.length} unmapped=${unmapped} problems=${problems.length}`;
  return { ok: items.length > 0 && problems.length === 0, problems, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const r = check(readFileSync(o.source, "utf8"), readFileSync(o.map, "utf8"));
  for (const p of r.problems) console.log(p);
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
