#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = ["CLAUDE.md", "AUTONOMY.md"];
export const SOURCES = [
  "CLAUDE.md",
  "AUTONOMY.md",
  "docs/pm-pass.md",
  "docs/worker-brief.md",
  "docs/BACKLOG.md",
];
export const SOURCE_DIRS = ["docs/runbooks", "docs/briefs"];

const USAGE = "usage: node scripts/directive-refs.mjs [--root <dir>]";

const ATTEMPT = /`(CLAUDE\.md|AUTONOMY\.md)`\s*(→|§)/g;
const QUOTED = /^\s*"([^"]+)"(?=[\s,.;:)\]!?—–]|$)/;
const SECTION = /^"([^"]+)"(?=[\s,.;:)\]!?—–]|$)/;

export function parseArgs(argv) {
  const o = { root: fileURLToPath(new URL("..", import.meta.url)) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("--root needs a value");
      o.root = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();

export function headings(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{2,3} (.+)$/.exec(line);
    if (m) out.push(collapse(m[1]));
  }
  return out;
}

export function paragraphs(text) {
  const out = [];
  let current = null;
  text.split("\n").forEach((line, index) => {
    const body = line.replace(/^\s*(?:>\s?)*/, "");
    if (/^\s*(```|~~~)/.test(line) || body.trim() === "") {
      current = null;
      return;
    }
    const isRow = /^\s*\|/.test(body);
    const isHeading = /^\s{0,3}#{1,6}(?:\s|$)/.test(body);
    const isItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(body);
    if (isRow || isHeading || isItem || current === null) {
      current = { text: "", offsets: [] };
      out.push(current);
    }
    if (current.text !== "") current.text += " ";
    current.offsets.push({ at: current.text.length, line: index + 1 });
    current.text += body.trim();
    if (isRow || isHeading) current = null;
  });
  return out;
}

function lineAt(offsets, at) {
  let line = offsets[0].line;
  for (const o of offsets) if (o.at <= at) line = o.line;
  return line;
}

export function citations(text) {
  const out = [];
  for (const p of paragraphs(text)) {
    for (const m of p.text.matchAll(ATTEMPT)) {
      const [, target, symbol] = m;
      const rest = p.text.slice(m.index + m[0].length);
      const quoted = (symbol === "§" ? SECTION : QUOTED).exec(rest);
      const read = quoted !== null && quoted[1] === quoted[1].trim() ? quoted : null;
      const cited = read === null ? null : collapse(read[1]);
      const length = m[0].length + (read === null ? 0 : read[0].trimEnd().length);
      const start = lineAt(p.offsets, m.index);
      const end = lineAt(p.offsets, m.index + length - 1);
      const shown =
        cited === null
          ? `\`${target}\` ${symbol}${rest.slice(0, 40)}`
          : `\`${target}\` ${symbol === "§" ? `§"${cited}"` : `→ "${cited}"`}`;
      out.push({ target, cited, start, end, shown });
    }
  }
  return out;
}

export function startsWithWords(heading, cited) {
  if (!heading.startsWith(cited)) return false;
  return !(/\w$/.test(cited) && /^\w/.test(heading.slice(cited.length)));
}

export function sourceFiles(root) {
  const files = SOURCES.filter((f) => existsSync(join(root, f)));
  for (const dir of SOURCE_DIRS) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir)).sort()) {
      if (name.endsWith(".md")) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

export function check(root) {
  const targets = new Map();
  for (const t of TARGETS) {
    const path = join(root, t);
    targets.set(t, existsSync(path) ? headings(readFileSync(path, "utf8")) : null);
  }
  const dead = [];
  let total = 0;
  for (const file of sourceFiles(root)) {
    for (const c of citations(readFileSync(join(root, file), "utf8"))) {
      total += 1;
      const heads = targets.get(c.target);
      const where = `${file}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}`;
      if (c.cited === null)
        dead.push({
          ...c,
          file,
          where,
          reason: `cannot read this citation; write it as → "Heading" or §"Heading"`,
        });
      else if (heads === null) dead.push({ ...c, file, where, reason: `${c.target} is missing` });
      else if (!heads.some((h) => startsWithWords(h, c.cited)))
        dead.push({ ...c, file, where, reason: `no heading in ${c.target} starts with this` });
    }
  }
  return { total, dead };
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  const { total, dead } = check(o.root);
  for (const d of dead) console.log(`dead ${d.where} — ${d.reason} — ${d.shown}`);
  if (dead.length > 0) {
    console.log(`directive-refs: ${dead.length} of ${total} citations dead`);
    return 1;
  }
  console.log(`directive-refs: ${total} citations, all resolve`);
  return 0;
}

const invoked =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) process.exitCode = main(process.argv.slice(2));
