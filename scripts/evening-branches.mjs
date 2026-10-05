#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { realRunner, resolveRepo } from "./land-prs.mjs";

export const DECISIONS_HEADING = "## Operator decisions";
const BACKLOG = "docs/BACKLOG.md";
const BRANCH_GLOBS = ["claude", "fix"];
export const ASK_PATTERN = /_Ask:_|\*\*Ask:?\*\*|\bAsk:|_Pick:_|\?\s*$/i;

const USAGE =
  "usage: node scripts/evening-branches.mjs [--repo owner/repo] [--base main] [--min-age-hours 2] [--fresh-hours 36] [--since-days 7] [--main-since <iso>] [--no-fetch] [--json]";

export function parseArgs(argv) {
  const o = {
    repo: undefined,
    base: "main",
    minAgeHours: 2,
    freshHours: 36,
    sinceDays: 7,
    mainSince: undefined,
    fetch: true,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    const num = () => {
      const v = Number(next());
      if (!Number.isFinite(v) || v < 0) throw new Error(`${a} needs a non-negative number`);
      return v;
    };
    if (a === "--repo") o.repo = next();
    else if (a === "--base") o.base = next();
    else if (a === "--min-age-hours") o.minAgeHours = num();
    else if (a === "--since-days") o.sinceDays = num();
    else if (a === "--fresh-hours") o.freshHours = num();
    else if (a === "--main-since") {
      const v = next();
      if (Number.isNaN(Date.parse(v)) || !/(Z|[+-]\d\d:?\d\d)$/.test(v))
        throw new Error(`${a} needs an ISO time with Z or an offset`);
      o.mainSince = v;
    } else if (a === "--no-fetch") o.fetch = false;
    else if (a === "--json") o.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function sectionRange(text, heading = DECISIONS_HEADING) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end };
}

export function addedLines(diffU0) {
  const out = [];
  let line = 0;
  for (const raw of diffU0.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (raw.startsWith("+++")) continue;
    if (raw.startsWith("+")) {
      out.push({ line, text: raw.slice(1) });
      line++;
    }
  }
  return out;
}

export function decisionLines(branchText, diffU0, mainText) {
  const range = sectionRange(branchText);
  if (!range) return { onlyOnBranch: [], alreadyOnMain: [] };
  const onMain = new Set(mainText.split("\n").map((l) => l.trim()));
  const onlyOnBranch = [];
  const alreadyOnMain = [];
  for (const a of addedLines(diffU0)) {
    if (a.line <= range.start || a.line > range.end) continue;
    if (a.text.trim() === "") continue;
    (onMain.has(a.text.trim()) ? alreadyOnMain : onlyOnBranch).push(a);
  }
  return { onlyOnBranch, alreadyOnMain };
}

export function namedInSection(text, branch) {
  const esc = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(^|[^\\w.-])${esc}($|\\.(?!\\w)|[^\\w./-])`);
  const range = sectionRange(text);
  if (!range) return false;
  return text
    .split("\n")
    .slice(range.start, range.end)
    .some((l) => named.test(l));
}

export function prCoverage(prs, tipSha) {
  const open = prs.find((p) => p.state === "open");
  if (open) return { kind: "open", pr: open.number, draft: !!open.draft };
  const merged = prs.filter((p) => p.merged_at);
  for (const p of merged) {
    if (p.head?.sha === tipSha) return { kind: "merged", pr: p.number };
  }
  const latest = merged.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))[0];
  if (latest) return { kind: "after-merge", pr: latest.number, headSha: latest.head?.sha };
  const closed = prs.find((p) => p.state === "closed");
  if (closed) return { kind: "closed", pr: closed.number };
  return { kind: "none" };
}

export function classify(b, opts) {
  const ageHours = (opts.now - b.tipTime * 1000) / 3_600_000;
  const settled = b.coverage.kind === "merged" || b.ahead === 0;
  const unprotected = !settled && b.coverage.kind !== "open";
  const question = !settled && b.decisions.onlyOnBranch.length > 0;
  return {
    ageHours,
    fresh: ageHours < opts.freshHours,
    stale: unprotected && ageHours >= opts.minAgeHours,
    question,
    ask: question && b.decisions.onlyOnBranch.some((l) => ASK_PATTERN.test(l.text)),
  };
}

function git(ctx, args, timeoutMs = 60_000) {
  return ctx.run("git", args, { cwd: ctx.cwd, timeoutMs });
}

async function gitOut(ctx, args) {
  const r = await git(ctx, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

async function prsFor(ctx, branch) {
  const owner = ctx.repo.split("/")[0];
  const path = `repos/${ctx.repo}/pulls?state=all&per_page=100&head=${owner}:${encodeURIComponent(branch)}`;
  const r = await ctx.run("gh", ["api", path], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`gh api ${path} failed: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout);
}

export async function eveningBranches(o, deps = {}) {
  const ctx = {
    run: deps.run ?? realRunner,
    cwd: deps.cwd,
    repo: o.repo,
    now: deps.now ?? Date.now(),
  };
  const remoteBase = `origin/${o.base}`;
  if (o.fetch) {
    const specs = [`+refs/heads/${o.base}:refs/remotes/${remoteBase}`];
    for (const g of BRANCH_GLOBS) specs.push(`+refs/heads/${g}/*:refs/remotes/origin/${g}/*`);
    await gitOut(ctx, ["fetch", "-q", "--prune", "origin", ...specs]);
  }
  const refs = (
    await gitOut(ctx, [
      "for-each-ref",
      "--format=%(refname:short)%09%(objectname)%09%(committerdate:unix)%09%(subject)",
      ...BRANCH_GLOBS.map((g) => `refs/remotes/origin/${g}`),
    ])
  )
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [ref, sha, time, subject] = l.split("\t");
      return { ref, branch: ref.replace(/^origin\//, ""), sha, tipTime: Number(time), subject };
    });
  const horizon = ctx.now / 1000 - o.sinceDays * 86_400;
  const recent = refs.filter((r) => r.tipTime >= horizon);
  const mainBacklog = await gitOut(ctx, ["show", `${remoteBase}:${BACKLOG}`]);
  const results = [];
  for (const r of recent) {
    const prs = await prsFor(ctx, r.branch);
    const coverage = prCoverage(prs, r.sha);
    let base = remoteBase;
    if (coverage.kind === "after-merge" && coverage.headSha) {
      const anc = await git(ctx, ["merge-base", "--is-ancestor", coverage.headSha, r.ref]);
      if (anc.code === 0) base = coverage.headSha;
    }
    const cherryArgs = ["cherry", remoteBase, r.ref];
    if (base !== remoteBase) cherryArgs.push(base);
    const cherry = await gitOut(ctx, cherryArgs);
    const ahead = cherry.split("\n").filter((l) => l.startsWith("+")).length;
    let decisions = { onlyOnBranch: [], alreadyOnMain: [] };
    if (ahead > 0) {
      const diff = await gitOut(ctx, ["diff", "-U0", `${base}...${r.ref}`, "--", BACKLOG]);
      if (diff.trim()) {
        const shown = await git(ctx, ["show", `${r.ref}:${BACKLOG}`]);
        if (shown.code === 0) decisions = decisionLines(shown.stdout, diff, mainBacklog);
      }
    }
    const b = {
      ...r,
      ahead,
      coverage,
      decisions,
      namedOnMain: namedInSection(mainBacklog, r.branch),
    };
    results.push({
      ...b,
      ...classify(b, { now: ctx.now, minAgeHours: o.minAgeHours, freshHours: o.freshHours }),
    });
  }
  let mainDecisions = null;
  if (o.mainSince) {
    const rev = (
      await gitOut(ctx, ["rev-list", "-1", "--first-parent", `--before=${o.mainSince}`, remoteBase])
    ).trim();
    if (!rev) throw new Error(`--main-since ${o.mainSince}: ${remoteBase} has no commit before it`);
    {
      const diff = await gitOut(ctx, ["diff", "-U0", `${rev}..${remoteBase}`, "--", BACKLOG]);
      const before = await gitOut(ctx, ["show", `${rev}:${BACKLOG}`]);
      mainDecisions = {
        since: o.mainSince,
        rev,
        lines: decisionLines(mainBacklog, diff, before).onlyOnBranch,
      };
    }
  }
  return {
    repo: o.repo,
    base: o.base,
    now: new Date(ctx.now).toISOString(),
    minAgeHours: o.minAgeHours,
    freshHours: o.freshHours,
    sinceDays: o.sinceDays,
    scanned: recent.length,
    olderSkipped: refs.length - recent.length,
    branches: results,
    mainDecisions,
  };
}

const cov = (c) =>
  c.kind === "none"
    ? "no PR"
    : c.kind === "after-merge"
      ? `commits after merged #${c.pr}`
      : `${c.kind} #${c.pr}${c.draft ? " (draft)" : ""}`;

export function formatReport(rep) {
  const out = [];
  const asks = rep.branches.filter((b) => b.ask);
  const questions = rep.branches.filter((b) => b.question && !b.ask);
  const stale = rep.branches.filter((b) => b.stale);
  const freshStale = stale.filter((b) => b.fresh);
  out.push(
    `EVENING_BRANCHES_SUMMARY ${rep.mainDecisions ? `main_decision_lines=${rep.mainDecisions.lines.length} ` : ""}asks=${asks.length} decision_lines=${questions.length} stale=${stale.length} stale_fresh=${freshStale.length} scanned=${rep.scanned} older_skipped=${rep.olderSkipped} now=${rep.now}`,
  );
  const lines = (title, list) => {
    out.push("");
    out.push(`## ${title} (${list.length})`);
    for (const b of list) {
      const carried = b.namedOnMain
        ? `; ${rep.base}'s "Operator decisions" already names this branch, so check before lifting`
        : "";
      out.push(
        `- ${b.branch} (${cov(b.coverage)}, ${b.decisions.onlyOnBranch.length} line(s) under "Operator decisions" not on ${rep.base}${carried})`,
      );
      for (const l of b.decisions.onlyOnBranch.slice(0, 12))
        out.push(`    L${l.line}: ${l.text.trim()}`);
      if (b.decisions.onlyOnBranch.length > 12)
        out.push(`    … ${b.decisions.onlyOnBranch.length - 12} more`);
    }
  };
  if (rep.mainDecisions) {
    const m = rep.mainDecisions;
    out.push("");
    out.push(
      `## Lines added under "Operator decisions" on ${rep.base} since ${m.since} (${m.lines.length}, from ${m.rev.slice(0, 7)})`,
    );
    for (const l of m.lines) out.push(`    L${l.line}: ${l.text.trim()}`);
  }
  lines(
    'Asks only on a branch: an Ask/Pick line or a question under "Operator decisions", not on ' +
      rep.base,
    asks,
  );
  lines(
    `Other lines under "Operator decisions" only on a branch, last commit under ${rep.freshHours} h`,
    questions.filter((b) => b.fresh),
  );
  const oldLines = questions.filter((b) => !b.fresh);
  if (oldLines.length)
    out.push(`  older, not repeated: ${oldLines.map((b) => b.branch).join(", ")}`);
  out.push("");
  out.push(
    `## Unprotected branches: commits not on ${rep.base}, no open or merged PR, last commit ≥ ${rep.minAgeHours} h old (${stale.length}, ${freshStale.length} under ${rep.freshHours} h)`,
  );
  for (const b of [...freshStale, ...stale.filter((b) => !b.fresh)]) {
    out.push(
      `- ${b.fresh ? "NEW  " : "older"} ${b.branch}: ${b.ahead} commit(s) not on ${rep.base}, ${cov(b.coverage)}, last commit ${b.ageHours.toFixed(1)} h ago — ${b.subject}`,
    );
  }
  out.push("");
  out.push(`## Everything scanned (last ${rep.sinceDays} days)`);
  for (const b of rep.branches) {
    const flags =
      [b.ask ? "ASK" : b.question && "LINES", b.stale && "STALE"].filter(Boolean).join(",") || "ok";
    out.push(
      `- ${flags.padEnd(14)} ${b.branch}: ahead=${b.ahead}, ${cov(b.coverage)}, ${b.ageHours.toFixed(1)} h`,
    );
  }
  return out.join("\n") + "\n";
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`evening-branches: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (!o.repo) {
    const { repo, error } = await resolveRepo();
    if (!repo) {
      process.stderr.write(`evening-branches: cannot tell the repo (pass --repo): ${error}\n`);
      process.exitCode = 2;
      return;
    }
    o.repo = repo;
  }
  const rep = await eveningBranches(o);
  process.stdout.write(o.json ? JSON.stringify(rep, null, 2) + "\n" : formatReport(rep));
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
    process.stderr.write(`evening-branches: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
