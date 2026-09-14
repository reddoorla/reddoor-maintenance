#!/usr/bin/env node
// Wasted-work census: heuristics nominate CANDIDATE episodes with a token cost; a
// refuter confirms or rejects each from its transcript window
// (scripts/meta-week/transcript-window.mjs). See docs/meta-week/11-wasted-work-census.md.
//
//   node scripts/meta-week/census.mjs [--root DIR] [--class fanout|redo|unread|all]
//     [--top N] [--json FILE] [--jsonl FILE]
import { execFile } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectEvents } from "./lib/walk.mjs";
import { addSum, fanoutCandidates, redoCandidates, unreadCandidates } from "./lib/census.mjs";
import { emptySum } from "./lib/aggregate.mjs";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    class: "all",
    top: 10,
    json: null,
    jsonl: null,
    git: null,
    since: "2026-08-16",
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
      case "--class":
        o.class = next();
        break;
      case "--top":
        o.top = Number(next());
        break;
      case "--json":
        o.json = next();
        break;
      case "--jsonl":
        o.jsonl = next();
        break;
      case "--git":
        o.git = next();
        break;
      case "--since":
        o.since = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!["fanout", "redo", "unread", "all"].includes(o.class)) {
    throw new Error("--class must be fanout|redo|unread|all");
  }
  return o;
}

const FINDERS = {
  fanout: fanoutCandidates,
  redo: redoCandidates,
  unread: unreadCandidates,
};
const fmt = (n) => Number(n).toLocaleString("en-US");

function summarize(cands) {
  const byKind = {};
  for (const c of cands) {
    const k = byKind[c.kind] || (byKind[c.kind] = { candidates: 0, cost: emptySum() });
    k.candidates += 1;
    addSum(k.cost, c.cost);
  }
  return byKind;
}

function printClass(name, byKind, cands, top) {
  process.stdout.write(
    `\n== ${name} ==\nkind\tcandidates\tout\tcacheCreate\tcacheRead\tagentTotal\n`,
  );
  for (const [kind, k] of Object.entries(byKind)) {
    process.stdout.write(
      `${kind}\t${k.candidates}\t${fmt(k.cost.out)}\t${fmt(k.cost.cacheCreate)}\t${fmt(k.cost.cacheRead)}\t${fmt(k.cost.agentTotal || 0)}\n`,
    );
  }
  for (const c of cands.slice(0, top)) {
    const ev = Object.entries(c.evidence)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ")
      .slice(0, 160);
    process.stdout.write(
      `  ${c.kind}\t${c.ts}\t${c.repo}\t${c.sessionId.slice(0, 8)}\tout=${fmt(c.cost.out)}\t${ev}\n`,
    );
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root, { full: true });
  const result = {
    root: o.root,
    files: all.files,
    prompts: all.prompts.length,
    tools: all.tools.length,
    agentResults: all.agentResults.length,
    interrupts: all.interrupts.length,
    classes: {},
  };
  process.stdout.write(
    `files=${all.files} prompts=${all.prompts.length} tools=${all.tools.length} agentResults=${all.agentResults.length} interrupts=${all.interrupts.length}\n`,
  );
  const wanted = o.class === "all" ? Object.keys(FINDERS) : [o.class].filter((c) => FINDERS[c]);
  const allCands = [];
  for (const name of wanted) {
    const cands = FINDERS[name](all).sort(
      (a, b) => b.cost.out - a.cost.out || b.cost.cacheCreate - a.cost.cacheCreate,
    );
    const byKind = summarize(cands);
    result.classes[name] = { byKind, candidates: cands };
    printClass(name, byKind, cands, o.top);
    allCands.push(...cands);
  }
  if (o.jsonl) await writeFile(o.jsonl, allCands.map((c) => JSON.stringify(c)).join("\n") + "\n");
  if (o.git) {
    const reverts = [];
    for (const name of await readdir(o.git)) {
      const dir = join(o.git, name);
      try {
        await stat(join(dir, ".git"));
      } catch {
        continue;
      }
      try {
        const { stdout } = await execFileAsync("git", [
          "-C",
          dir,
          "log",
          "--all",
          `--since=${o.since}`,
          "-i",
          "--grep=revert",
          "--format=%h|%aI|%s",
        ]);
        for (const line of stdout.trim().split("\n").filter(Boolean)) {
          const [sha, ts, ...subject] = line.split("|");
          reverts.push({ repo: name, sha, ts, subject: subject.join("|").slice(0, 120) });
        }
      } catch {
        // a repo git cannot read is reported by name, not silently skipped
        reverts.push({ repo: name, sha: "", ts: "", subject: "GIT LOG FAILED" });
      }
    }
    result.reverts = { since: o.since, count: reverts.length, byRepo: {}, items: reverts };
    for (const r of reverts)
      result.reverts.byRepo[r.repo] = (result.reverts.byRepo[r.repo] || 0) + 1;
    process.stdout.write(`\n== reverts (git, since ${o.since}, uncosted) ==\n`);
    for (const [repo, c] of Object.entries(result.reverts.byRepo))
      process.stdout.write(`${repo}\t${c}\n`);
  }
  if (o.json) await writeFile(o.json, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  process.stderr.write(`census: ${e.message}\n`);
  process.exit(1);
});
