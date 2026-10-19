#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  PRICE_SOURCE,
  formatTable,
  mergeRecords,
  splitLines,
  summarise,
  usageRecords,
} from "./lib/ledger.mjs";

export function category(rel) {
  const parts = rel.split(sep);
  if (parts.length === 2) return "main";
  if (parts.length === 4 && parts[2] === "subagents") return "sub";
  if (parts.length === 6 && parts[2] === "subagents" && parts[3] === "workflows") return "wf";
  return null;
}

function walk(d, out = []) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out.sort();
}

export function ledger(root, { since, until } = {}) {
  const from = since ? Date.parse(since) : -Infinity;
  const to = until ? Date.parse(until) : Infinity;
  const files = walk(root).filter((f) => {
    const m = statSync(f).mtimeMs;
    return m >= from && m < to;
  });
  const perFile = [];
  const diag = { files: 0, skipped: 0, usageLines: 0, repeats: 0, parseErrors: 0, noId: 0 };
  for (const f of files) {
    const cat = category(relative(root, f));
    if (!cat) {
      diag.skipped++;
      continue;
    }
    diag.files++;
    const { records, diag: d } = usageRecords(splitLines(readFileSync(f, "utf8")));
    for (const k of ["usageLines", "repeats", "parseErrors", "noId"]) diag[k] += d[k];
    perFile.push(records.map((r) => ({ ...r, cat })));
  }
  const { records, crossFileRepeats } = mergeRecords(perFile);
  diag.crossFileRepeats = crossFileRepeats;
  const byCat = { main: [], sub: [], wf: [] };
  for (const r of records) byCat[r.cat].push(r);
  return {
    root,
    window: { since: since || null, until: until || null },
    prices: PRICE_SOURCE,
    diag,
    all: summarise([...byCat.main, ...byCat.sub, ...byCat.wf]),
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, summarise(v)])),
  };
}

const NAMES = { main: "Main session", sub: "Plain subagent", wf: "Workflow subagent" };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      json: { type: "string" },
    },
  });
  const root = resolve(
    values.root || process.env.LEDGER_ROOT || join(homedir(), ".claude", "projects"),
  );
  const r = ledger(root, values);
  if (values.json) writeFileSync(values.json, JSON.stringify(r, null, 1) + "\n");
  console.log(
    `Transcripts under ${root}; mtime window ${r.window.since ?? "-"} to ${r.window.until ?? "-"}.`,
  );
  console.log(`Prices: ${r.prices}. Unlisted models are reported as unpriced, never estimated.`);
  console.log(
    `${r.diag.files} files (${r.diag.skipped} skipped: not a main, subagent or workflow transcript), ${r.diag.usageLines} usage lines, ${r.diag.repeats} repeats dropped by message.id within a file and ${r.diag.crossFileRepeats} across files, ${r.diag.parseErrors} unparseable.\n`,
  );
  console.log("## All sources, by message.model and effort\n");
  console.log(formatTable(r.all));
  for (const [k, s] of Object.entries(r.byCategory)) {
    if (!s.total.requests) continue;
    console.log(`\n## ${NAMES[k]}\n`);
    console.log(formatTable(s));
  }
}
