#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  realpathSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { realRunner } from "./land-prs.mjs";

export const STATUSES = ["open", "answered", "parked", "withdrawn"];
export const FIELDS = ["status", "asked", "from", "refs"];
export const NAME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const ASKED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/;
export const SESSION_URL = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+$/;
export const REF_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;
export const DEFAULT_OWNER = "reddoorla";
export const HOME_REPO = "reddoorla/reddoor-maintenance";
const BACKLOG = "docs/BACKLOG.md";
const DECISIONS_HEADING = "## Operator decisions";

const USAGE = [
  "usage: node scripts/decisions.mjs check <dir> [--offline] [--json]",
  "       node scripts/decisions.mjs list <dir> (--open | --parked) [--since <iso>] [--offline] [--json]",
  "       node scripts/decisions.mjs new <dir> <slug> [--from owner/repo#N]",
  "       node scripts/decisions.mjs convert <outdir> [--rev origin/main]",
].join("\n");

export const FUTURE_SLACK_MS = 10 * 60_000;
export const IGNORED_ENTRIES = ["_template.md", "README.md"];

export function calendarValid(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return false;
  const [y, mo, d, h = "0", mi = "0"] = m.slice(1);
  const t = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  return (
    t.getUTCFullYear() === +y &&
    t.getUTCMonth() === +mo - 1 &&
    t.getUTCDate() === +d &&
    t.getUTCHours() === +h &&
    t.getUTCMinutes() === +mi
  );
}

export function parseArgs(argv) {
  const o = {
    cmd: argv[0],
    dir: undefined,
    slug: undefined,
    open: false,
    parked: false,
    since: undefined,
    offline: false,
    json: false,
    from: undefined,
    rev: "origin/main",
  };
  if (!["check", "list", "new", "convert"].includes(o.cmd)) throw new Error("needs a command");
  const pos = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--open") o.open = true;
    else if (a === "--parked") o.parked = true;
    else if (a === "--offline") o.offline = true;
    else if (a === "--json") o.json = true;
    else if (a === "--from") o.from = next();
    else if (a === "--rev") o.rev = next();
    else if (a === "--since") {
      const v = next();
      if (Number.isNaN(Date.parse(v)) || !/(Z|[+-]\d\d:?\d\d)$/.test(v) || !calendarValid(v))
        throw new Error(`${a} needs an ISO time with Z or an offset`);
      o.since = v;
    } else if (a.startsWith("--")) throw new Error(`unknown argument: ${a}`);
    else pos.push(a);
  }
  const want = o.cmd === "new" ? 2 : 1;
  if (pos.length !== want) throw new Error(`${o.cmd} takes ${want} positional argument(s)`);
  [o.dir, o.slug] = pos;
  if (o.cmd === "list" && o.open === o.parked)
    throw new Error("list needs exactly one of --open or --parked");
  if (o.cmd !== "list" && (o.open || o.parked || o.since))
    throw new Error("--open, --parked and --since belong to list");
  if (o.from !== undefined && o.cmd !== "new") throw new Error("--from belongs to new");
  if (o.rev !== "origin/main" && o.cmd !== "convert") throw new Error("--rev belongs to convert");
  if (o.offline && !["check", "list"].includes(o.cmd))
    throw new Error("--offline belongs to check and list");
  if (o.from !== undefined && !REF_PATTERN.test(o.from))
    throw new Error("--from needs owner/repo#N");
  return o;
}

export function stripComments(text) {
  let out = "";
  let i = 0;
  for (;;) {
    const open = text.indexOf("<!--", i);
    if (open === -1) return { text: out + text.slice(i), unclosed: false };
    out += text.slice(i, open);
    const end = text.indexOf("-->", open + 4);
    if (end === -1) return { text: out, unclosed: true };
    const inner = text.slice(open, end + 3);
    out += "\n".repeat(inner.split("\n").length - 1);
    i = end + 3;
  }
}

export function parseDecision(name, text, now = Date.now()) {
  const errors = [];
  const d = {
    file: name,
    slug: undefined,
    status: undefined,
    asked: undefined,
    from: undefined,
    refs: [],
    ask: undefined,
    errors,
  };
  const nm = NAME_PATTERN.exec(name);
  if (!nm) errors.push("file name is not <YYYY-MM-DD-HHMM>-<slug>.md");
  else d.slug = nm[6];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") {
    errors.push("no front matter: the first line is not ---");
    return d;
  }
  const close = lines.indexOf("---", 1);
  if (close === -1) {
    errors.push("front matter is not closed with ---");
    return d;
  }
  const seen = new Set();
  for (const raw of lines.slice(1, close)) {
    if (raw.trim() === "") continue;
    const m = /^([a-z]+):\s*(.*?)\s*$/.exec(raw);
    if (!m) {
      errors.push(`front matter line is not "key: value": ${raw}`);
      continue;
    }
    const [, key, value] = m;
    if (!FIELDS.includes(key)) {
      errors.push(`unknown front matter field: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`front matter field given twice: ${key}`);
      continue;
    }
    seen.add(key);
    if (key === "status") {
      if (!STATUSES.includes(value)) errors.push(`unknown status: ${value || "(empty)"}`);
      else d.status = value;
    } else if (key === "asked") {
      if (!ASKED_PATTERN.test(value) || Number.isNaN(Date.parse(value)) || !calendarValid(value))
        errors.push(`asked is not a UTC time like 2026-10-13T13:51Z: ${value || "(empty)"}`);
      else if (Date.parse(value) > now + FUTURE_SLACK_MS)
        errors.push(`asked is in the future: ${value}`);
      else d.asked = value;
    } else if (key === "from") {
      if (!SESSION_URL.test(value) && !REF_PATTERN.test(value))
        errors.push(`from is neither a session URL nor owner/repo#N: ${value || "(empty)"}`);
      else d.from = value;
    } else if (key === "refs") {
      const lm = /^\[(.*)\]$/.exec(value);
      if (!lm) {
        errors.push(`refs is not a [list]: ${value || "(empty)"}`);
        continue;
      }
      const items = lm[1].trim() === "" ? [] : lm[1].split(",").map((s) => s.trim());
      for (const r of items) {
        if (!REF_PATTERN.test(r)) errors.push(`ref is not owner/repo#N: ${r || "(empty)"}`);
        else if (!d.refs.includes(r)) d.refs.push(r);
      }
    }
  }
  for (const f of FIELDS) if (!seen.has(f)) errors.push(`missing front matter field: ${f}`);
  if (nm && d.asked) {
    const named = `${nm[1]}-${nm[2]}-${nm[3]}T${nm[4]}:${nm[5]}`;
    if (named !== d.asked.slice(0, 16))
      errors.push(`file name time ${named}Z does not match asked ${d.asked}`);
  }
  const { text: visible, unclosed } = stripComments(lines.slice(close + 1).join("\n"));
  const body = visible.split("\n");
  if (unclosed) errors.push("a comment opens and never closes");
  const first = body.find((l) => l.trim() !== "");
  if (first === undefined || /^#{1,6}(\s|$)/.test(first.trim()))
    errors.push("missing first line: the ask");
  else if (/^(?:[-*+>_\s]|\d+\.\s)*TODO(?![A-Za-z0-9])/i.test(first.trim()))
    errors.push("the ask is still the TODO placeholder");
  else d.ask = first.trim();
  if (d.status === "answered") {
    const at = body.findIndex((l) => /^##\s+Answer\s*$/.test(l));
    const rest = at === -1 ? [] : body.slice(at + 1);
    const stop = rest.findIndex((l) => /^#{1,2}\s/.test(l));
    const answer = (stop === -1 ? rest : rest.slice(0, stop)).filter(
      (l) => l.trim() !== "" && !/^#{1,6}(\s|$)/.test(l.trim()),
    );
    if (answer.length === 0) errors.push("status is answered but ## Answer is empty");
  }
  return d;
}

export function readDecisionDir(dir, now = Date.now()) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORED_ENTRIES.includes(e.name) && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  return entries.map((e) =>
    e.isFile()
      ? parseDecision(e.name, readFileSync(join(dir, e.name), "utf-8"), now)
      : { file: e.name, refs: [], errors: ["not a regular file"] },
  );
}

export async function refState(ref, asked, run) {
  const m = REF_PATTERN.exec(ref);
  const path = `repos/${m[1]}/${m[2]}/issues/${m[3]}`;
  let r;
  try {
    r = await run("gh", ["api", path], { timeoutMs: 60_000 });
  } catch (e) {
    return { ref, kind: "unchecked", why: String(e?.message ?? e) };
  }
  if (r.code !== 0)
    return {
      ref,
      kind: "unchecked",
      why: (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n")[0],
    };
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    return { ref, kind: "unchecked", why: "gh api returned something that is not JSON" };
  }
  if (!j.pull_request) return { ref, kind: "issue" };
  const merged = j.pull_request.merged_at ?? null;
  const at = merged ?? j.closed_at ?? null;
  if (at && Date.parse(at) > Date.parse(asked))
    return { ref, kind: "stale", event: merged ? "merged" : "closed", at };
  return { ref, kind: "ok" };
}

export async function decisionsReport(o, deps = {}) {
  const run = deps.run ?? realRunner;
  const now = deps.now ?? Date.now();
  let all = deps.decisions;
  let dirError;
  if (!all) {
    try {
      all = readDecisionDir(o.dir, now);
    } catch (e) {
      all = [];
      dirError = e.code ? `cannot read the directory (${e.code})` : String(e?.message ?? e);
    }
  }
  const good = all.filter((d) => d.errors.length === 0);
  for (const d of good) {
    d.ageHours = (now - Date.parse(d.asked)) / 3_600_000;
    d.refStates = [];
    if (d.status !== "open") continue;
    for (const ref of d.refs.filter((r) => r !== d.from))
      d.refStates.push(
        o.offline
          ? { ref, kind: "unchecked", why: "--offline" }
          : await refState(ref, d.asked, run),
      );
  }
  const byAsked = (a, b) =>
    Date.parse(a.asked) - Date.parse(b.asked) || a.file.localeCompare(b.file);
  const counts = {
    parsed: good.length,
    errors: all.length - good.length,
    open: good.filter((d) => d.status === "open").length,
    parked: good.filter((d) => d.status === "parked").length,
    unchecked: good.reduce(
      (n, d) => n + d.refStates.filter((s) => s.kind === "unchecked").length,
      0,
    ),
  };
  return {
    dir: o.dir,
    now: new Date(now).toISOString(),
    counts,
    ok: counts.errors === 0 && counts.parsed > 0,
    dirError,
    failed: all.filter((d) => d.errors.length > 0),
    decisions: good.sort(byAsked),
  };
}

export function selectListed(rep, o) {
  const want = o.open ? "open" : "parked";
  return rep.decisions.filter(
    (d) => d.status === want && (!o.since || Date.parse(d.asked) >= Date.parse(o.since)),
  );
}

export function summaryLine(c) {
  return `DECISIONS_SUMMARY parsed=${c.parsed} errors=${c.errors} open=${c.open} parked=${c.parked} unchecked=${c.unchecked}`;
}

function failureLines(rep) {
  const out = [];
  if (rep.dirError) out.push(`ERROR ${rep.dir}: ${rep.dirError}`);
  else if (rep.counts.parsed === 0) out.push(`ERROR ${rep.dir}: no decision file parsed`);
  for (const d of rep.failed) for (const e of d.errors) out.push(`ERROR ${d.file}: ${e}`);
  return out;
}

export function formatCheck(rep) {
  const out = [summaryLine(rep.counts), ...failureLines(rep)];
  for (const d of rep.decisions)
    for (const s of d.refStates ?? [])
      if (s.kind === "unchecked" && s.why !== "--offline")
        out.push(`UNCHECKED ${s.ref} in ${d.file}: ${s.why}`);
  return out.join("\n") + "\n";
}

export function formatList(rep, o) {
  const listed = selectListed(rep, o);
  const out = [summaryLine(rep.counts), ...failureLines(rep)];
  out.push(
    `${listed.length} ${o.open ? "open" : "parked"}${o.since ? ` asked since ${o.since}` : ""}, oldest first`,
  );
  for (const d of listed) {
    out.push(`- ${d.ageHours.toFixed(1)} h  ${d.file.replace(/\.md$/, "")}  ${d.ask}  (${d.from})`);
    for (const s of d.refStates) {
      if (s.kind === "stale")
        out.push(`    possibly stale: ${s.ref} ${s.event} ${s.at}, after it was asked`);
      else if (s.kind === "unchecked") out.push(`    UNCHECKED ${s.ref}: ${s.why}`);
    }
  }
  return out.join("\n") + "\n";
}

export function sessionUrl(id) {
  const m = /^cse_([A-Za-z0-9]+)$/.exec(id ?? "") ?? /^session_([A-Za-z0-9]+)$/.exec(id ?? "");
  return m ? `https://claude.ai/code/session_${m[1]}` : undefined;
}

export function stamp(ms) {
  const iso = new Date(ms).toISOString();
  return {
    asked: `${iso.slice(0, 19)}Z`,
    prefix: `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`,
  };
}

export function newDecision({ slug, from, now }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`slug must be lowercase words joined by -: ${slug}`);
  const { asked, prefix } = stamp(now);
  const text = [
    "---",
    "status: open",
    `asked: ${asked}`,
    `from: ${from}`,
    "refs: []",
    "---",
    "",
    "TODO the ask, in one line.",
    "",
    "## Options",
    "",
    "## Pick",
    "",
    "## Answer",
    "",
  ].join("\n");
  return { name: `${prefix}-${slug}.md`, text };
}

export function backlogItems(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(DECISIONS_HEADING));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  const items = [];
  let cur = null;
  for (let i = start + 1; i < end; i++) {
    const m = /^(\d+)\.\s+(.*)$/.exec(lines[i]);
    if (m) {
      cur = { n: Number(m[1]), line: i + 1, head: m[2], body: [lines[i]] };
      items.push(cur);
    } else if (cur) cur.body.push(lines[i]);
  }
  for (const it of items) {
    while (it.body.length && it.body[it.body.length - 1].trim() === "") it.body.pop();
    it.text = it.body.join("\n");
  }
  return items;
}

export const STATUS_MARKERS = [
  /\*\*(?:Answered|Done|Resolved|Closed|Withdrawn|Decided|Settled)\b/i,
];
export const HEAD_MARKERS = [
  /\b(?:answered|decided|settled|resolved|closed|withdrawn)\b[^.\n]{0,24}?20\d\d-\d\d-\d\d/i,
  /\bdone:/i,
  /\bnot an ask\b/i,
  /\bmerged by the operator\b/i,
];
export const STILL_OPEN =
  /\b(?:still|stays|remains|left|is) open\b|\bopen half\b|\b(?:answered|decided|settled)\b[^.\n]{0,40}?\bexcept\b/i;
export const PROSE_MARKERS = [/\banswered\b/i, /\bresolved\b/i, /\bwithdrawn\b/i, /\bsettled\b/i];

const firstMatch = (res, text) => {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
};

export function classifyItem(text) {
  const strong = firstMatch(STATUS_MARKERS, text) ?? firstMatch(HEAD_MARKERS, itemLead(text));
  const reopened = STILL_OPEN.exec(text);
  if (strong && !reopened) return { kind: "answered", marker: strong };
  if (strong) return { kind: "ambiguous", marker: `${strong} … ${reopened[0]}` };
  const prose = firstMatch(PROSE_MARKERS, text);
  if (prose) return { kind: "ambiguous", marker: prose };
  return { kind: "open", marker: null };
}

export function itemTitle(text) {
  const body = text.replace(/^\d+\.\s+/, "");
  const m = /^\*\*([\s\S]+?)\*\*/.exec(body);
  const t = m ? m[1] : body.split("\n")[0];
  return t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

export function itemAsk(text) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*(?:-\s*)?_Ask:_/.test(l));
  if (i === -1) return null;
  const parts = [lines[i].replace(/^\s*(?:-\s*)?_Ask:_\s*/, "")];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === "" || /^\s*-\s/.test(l)) break;
    parts.push(l.trim());
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function itemLead(text) {
  const para = [];
  for (const l of text.split("\n")) {
    if (para.length && (l.trim() === "" || /^\s*-\s/.test(l))) break;
    para.push(l.trim());
  }
  const flat = para
    .join(" ")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = /^(.{20,}?[.?])(\s|$)/.exec(flat);
  const lead = cut ? cut[1] : flat;
  return lead.length > 240 ? `${lead.slice(0, 239)}…` : lead;
}

export function dedent(text) {
  const [head, ...rest] = text.split("\n");
  const pads = rest.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length);
  const k = pads.length ? Math.min(...pads) : 0;
  return [head, ...rest.map((l) => l.slice(Math.min(k, /^ */.exec(l)[0].length)))].join("\n");
}

export function slugify(n, title) {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let s = `od-${n}`;
  for (const w of words) {
    if (s.length + w.length + 1 > 60) break;
    s += `-${w}`;
  }
  return s;
}

export const URL_REF =
  /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:pull|issues)\/(\d+)\b/g;

export function knownRepos(text) {
  const out = new Set([HOME_REPO, `${DEFAULT_OWNER}/.github`]);
  for (const m of text.matchAll(/(?<![\w./-])([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]*[A-Za-z0-9_])/g))
    if (m[1] === DEFAULT_OWNER) out.add(`${m[1]}/${m[2]}`);
  for (const m of text.matchAll(/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]*[A-Za-z0-9_])/g))
    if (m[1] === DEFAULT_OWNER) out.add(`${m[1]}/${m[2]}`);
  return out;
}

export function extractRefs(text, known = knownRepos(text)) {
  const named = [];
  const bare = [];
  const dropped = [];
  for (const m of text.matchAll(URL_REF)) {
    const ref = `${m[1]}/${m[2]}#${m[3]}`;
    if (REF_PATTERN.test(ref)) named.push(ref);
  }
  const re = /(?:^|[^\w/.#-])((?:[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+)?#(\d+)\b/g;
  for (const m of text.matchAll(re)) {
    if (m[1] === undefined) {
      bare.push(`${HOME_REPO}#${m[2]}`);
      continue;
    }
    const repo = m[1].includes("/") ? m[1] : `${DEFAULT_OWNER}/${m[1]}`;
    const ref = `${repo}#${m[2]}`;
    if (REF_PATTERN.test(ref) && (m[1].includes("/") || known.has(repo))) named.push(ref);
    else dropped.push(`${m[1]}#${m[2]}`);
  }
  const elsewhere = named.some((r) => !r.startsWith(`${HOME_REPO}#`)) || dropped.length > 0;
  const refs = [...new Set(elsewhere ? named : [...named, ...bare])];
  const lost = [
    ...new Set([...dropped, ...(elsewhere ? bare.map((r) => r.slice(HOME_REPO.length)) : [])]),
  ];
  return { refs, dropped: lost };
}

export function originNeedles(text) {
  const first = text.split("\n")[0].replace(/^\d+\.\s+/, "");
  const out = [first.slice(0, 60)];
  const bold = /^\*\*([^*\n]+?)\*\*/.exec(first);
  if (bold && bold[0].length >= 8 && bold[0] !== out[0]) out.push(bold[0]);
  return out;
}

export function convertItem(it, origin, revSha, known) {
  const title = itemTitle(it.text);
  const askLine = itemAsk(it.text);
  const ask = askLine ? `${title} — ${askLine}` : itemLead(it.text);
  const pr = origin && /\(#(\d+)\)\s*$/.exec(origin.subject);
  if (!origin)
    return {
      n: it.n,
      line: it.line,
      title,
      error: "no commit on the rev adds this item's first line",
    };
  if (!pr)
    return {
      n: it.n,
      line: it.line,
      title,
      error: `the commit that added it names no PR: ${origin.sha.slice(0, 8)} ${origin.subject}`,
    };
  const { asked, prefix } = stamp(origin.time * 1000);
  const name = `${prefix}-${slugify(it.n, title)}.md`;
  const from = `${HOME_REPO}#${pr[1]}`;
  const { refs, dropped } = extractRefs(it.text, known);
  const text = [
    "---",
    "status: open",
    `asked: ${asked}`,
    `from: ${from}`,
    `refs: [${refs.filter((r) => r !== from).join(", ")}]`,
    "---",
    "",
    ask,
    "",
    `Converted from ${HOME_REPO}@${revSha.slice(0, 8)}:${BACKLOG}, Operator decisions item ${it.n} (line ${it.line}), as it stood:`,
    "",
    dedent(it.text.replace(/^\d+\.\s+/, "")),
    "",
    "## Answer",
    "",
  ].join("\n");
  return { n: it.n, line: it.line, title, name, text, droppedRefs: dropped };
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function gitOut(run, cwd = REPO_ROOT, args) {
  const r = await run("git", args, { cwd, timeoutMs: 120_000 });
  if (r.code !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim().split("\n")[0]}`);
  return r.stdout;
}

export async function convertBacklog(o, deps = {}) {
  const run = deps.run ?? realRunner;
  const cwd = deps.cwd;
  const revSha = (await gitOut(run, cwd, ["rev-parse", o.rev])).trim();
  const text = await gitOut(run, cwd, ["show", `${revSha}:${BACKLOG}`]);
  const items = backlogItems(text);
  const known = knownRepos(text);
  const answered = [];
  const converted = [];
  const unparsed = [];
  const seenN = new Map();
  const duplicates = [];
  for (const it of items) {
    if (seenN.has(it.n)) duplicates.push({ n: it.n, lines: [seenN.get(it.n), it.line] });
    else seenN.set(it.n, it.line);
    const cls = classifyItem(it.text);
    if (cls.kind === "answered") {
      answered.push({ n: it.n, marker: cls.marker });
      continue;
    }
    const origins = [];
    for (const needle of originNeedles(it.text)) {
      const log = await gitOut(run, cwd, [
        "log",
        "--reverse",
        "--format=%H%x09%ct%x09%s",
        "-S",
        needle,
        revSha,
        "--",
        BACKLOG,
      ]);
      const first = log.split("\n").find(Boolean);
      if (!first) continue;
      const [sha, time, ...rest] = first.split("\t");
      origins.push({ sha, time: Number(time), subject: rest.join("\t") });
    }
    origins.sort((a, b) => a.time - b.time);
    const origin = origins[0] ?? null;
    const c = convertItem(it, origin, revSha, known);
    if (cls.kind === "ambiguous") c.ambiguous = cls.marker;
    if (new Set(origins.map((x) => x.sha)).size > 1)
      c.originsDisagree = origins.map((x) => x.sha.slice(0, 8));
    (c.error ? unparsed : converted).push(c);
  }
  const names = new Set();
  for (const c of converted) {
    let name = c.name;
    for (let k = 2; names.has(name); k++) name = c.name.replace(/\.md$/, `-${k}.md`);
    c.name = name;
    names.add(name);
  }
  return { rev: o.rev, revSha, items: items.length, answered, converted, unparsed, duplicates };
}

export function formatConvert(c) {
  const out = [
    `CONVERT_SUMMARY rev=${c.revSha.slice(0, 8)} items=${c.items} answered=${c.answered.length} open=${c.converted.length + c.unparsed.length} ambiguous=${[...c.converted, ...c.unparsed].filter((x) => x.ambiguous).length} written=${c.converted.length} unparsed=${c.unparsed.length}`,
  ];
  for (const x of c.converted) {
    const notes = [
      x.ambiguous && `AMBIGUOUS, matched "${x.ambiguous}"`,
      x.originsDisagree &&
        `origin needles disagree (${x.originsDisagree.join(", ")}), took the oldest`,
      x.droppedRefs?.length && `refs left out, repo not certain: ${x.droppedRefs.join(" ")}`,
    ].filter(Boolean);
    out.push(`- item ${x.n} → ${x.name}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
  }
  for (const a of c.answered) out.push(`- answered item ${a.n}  [${a.marker}]`);
  for (const d of c.duplicates ?? [])
    out.push(`DUPLICATE item number ${d.n} at lines ${d.lines.join(" and ")}`);
  for (const x of c.unparsed)
    out.push(`UNPARSED item ${x.n} (line ${x.line}, ${x.title}): ${x.error}`);
  return out.join("\n") + "\n";
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`decisions: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (o.cmd === "new") {
    const from = o.from ?? sessionUrl(process.env.CLAUDE_CODE_REMOTE_SESSION_ID);
    if (!from) {
      process.stderr.write(
        "decisions: CLAUDE_CODE_REMOTE_SESSION_ID is unset or not a cse_ or session_ id; pass --from owner/repo#N\n",
      );
      process.exitCode = 2;
      return;
    }
    let d;
    try {
      d = newDecision({ slug: o.slug, from, now: Date.now() });
    } catch (e) {
      process.stderr.write(`decisions: ${e.message}\n`);
      process.exitCode = 2;
      return;
    }
    const path = join(o.dir, d.name);
    if (existsSync(path)) {
      process.stderr.write(`decisions: ${path} already exists\n`);
      process.exitCode = 2;
      return;
    }
    try {
      mkdirSync(o.dir, { recursive: true });
      writeFileSync(path, d.text);
    } catch (e) {
      process.stderr.write(`decisions: cannot write ${path} (${e.code ?? e.message})\n`);
      process.exitCode = 2;
      return;
    }
    process.stdout.write(`${path}\n`);
    return;
  }
  if (o.cmd === "convert") {
    if (existsSync(o.dir) && !statSync(o.dir).isDirectory()) {
      process.stderr.write(`decisions: ${o.dir} is not a directory\n`);
      process.exitCode = 2;
      return;
    }
    if (existsSync(o.dir) && readdirSync(o.dir).length > 0) {
      process.stderr.write(
        `decisions: ${o.dir} is not empty; convert writes into an empty directory\n`,
      );
      process.exitCode = 2;
      return;
    }
    const c = await convertBacklog(o);
    mkdirSync(o.dir, { recursive: true });
    for (const x of c.converted) writeFileSync(join(o.dir, x.name), x.text);
    process.stdout.write(formatConvert(c));
    const rep = await decisionsReport({ dir: o.dir, offline: true });
    process.stdout.write(formatCheck(rep));
    if (!rep.ok) process.exitCode = 1;
    return;
  }
  const rep = await decisionsReport(o);
  if (o.json)
    process.stdout.write(
      JSON.stringify(o.cmd === "list" ? { ...rep, listed: selectListed(rep, o) } : rep, null, 2) +
        "\n",
    );
  else process.stdout.write(o.cmd === "list" ? formatList(rep, o) : formatCheck(rep));
  if (!rep.ok) process.exitCode = 1;
}

const self = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`decisions: ${e?.message ?? e}\n`);
    process.exitCode = 1;
  });
}
