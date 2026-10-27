#!/usr/bin/env node
// The per-model usage ledger (P1-83). Writes `ledger.csv` and `sessions.csv` in the workspace's
// private `usage/` folder; see this directory's README for the commands and when each runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  COLUMNS,
  SESSION_COLUMNS,
  backfill,
  finalize,
  listedSessions,
  mcpCalls,
  mergeRows,
  mergeSessions,
  parseCsv,
  readSessionTranscripts,
  reconcile,
  staleSessions,
  toCsv,
  transcriptId,
  transcriptRows,
} from "./lib/usage.mjs";

const read = (p) => (existsSync(p) ? parseCsv(readFileSync(p, "utf8")) : []);

function store(out, rows, sessions) {
  mkdirSync(out, { recursive: true });
  const ledgerPath = join(out, "ledger.csv");
  const sessionsPath = join(out, "sessions.csv");
  const done = finalize(
    mergeRows(read(ledgerPath), rows),
    mergeSessions(read(sessionsPath), sessions),
  );
  const order = (r) =>
    [r.session_created_at, r.session_id, r.source, r.agent_id, r.run_from, r.model, r.effort].join(
      "\u0000",
    );
  done.rows.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  writeFileSync(ledgerPath, toCsv(done.rows, COLUMNS));
  writeFileSync(sessionsPath, toCsv(done.sessions, SESSION_COLUMNS));
  return done;
}

const usd = (n) => `$${n.toFixed(2)}`;

function report({ rows, sessions }) {
  const byModel = new Map();
  for (const r of rows) {
    const k = `${r.source}\u0000${r.model}`;
    byModel.set(k, (byModel.get(k) ?? 0) + Number(r.cost_usd));
  }
  console.log("| source | model | list-price cost |\n|---|---|---|");
  for (const [k, v] of [...byModel].sort((a, b) => b[1] - a[1])) {
    const [source, model] = k.split("\u0000");
    console.log(`| ${source} | ${model} | ${usd(v)} |`);
  }
  const cov = {};
  for (const s of sessions)
    cov[s.coverage || "(transcript only)"] = (cov[s.coverage || "(transcript only)"] ?? 0) + 1;
  console.log(`\nSessions by coverage: ${JSON.stringify(cov)}`);
  const r = reconcile(rows, sessions);
  console.log(
    `Reconciled the runs of ${r.sessions} sessions against their result totals; ${r.mismatches.length} off by half a cent or more.`,
  );
  for (const m of r.mismatches)
    console.log(`  ${m.session_id}: rows ${usd(m.rows)}, total ${usd(m.total)}`);
  return r;
}

const HELP = `usage-ledger.mjs <command> --out <workspace>/usage [options]

  mcp         Read every claude-code-remote list_sessions / get_session / list_events result
              in the transcripts under --root (default ~/.claude/projects), and merge each
              cloud session's modelUsage, every run of its counter added, into the ledger.
  transcript  Merge per-agent rows from transcripts under --root: --session <uuid> for one
              (default $CLAUDE_CODE_SESSION_ID), or --all for every session there (the laptop).
              --id names the row (default: for this container's own session, the cloud ID from
              $CLAUDE_CODE_REMOTE_SESSION_ID; else the uuid); --environment labels it (default
              anthropic_cloud when that variable is set, else laptop).
  stale       Print the cloud sessions the newest list_sessions under --root shows as updated
              after their stored reading: the ones the next mcp harvest must re-read.
  check       Reconcile the stored modelUsage rows with each session's result total, to the cent.`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      root: { type: "string" },
      session: { type: "string" },
      id: { type: "string" },
      environment: { type: "string" },
      all: { type: "boolean" },
    },
  });
  const [cmd] = positionals;
  if (!cmd || !values.out) {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }
  const out = resolve(values.out);
  const root = resolve(
    values.root ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects"),
  );
  if (cmd !== "check" && !existsSync(root)) {
    console.error(`No transcript root at ${root}.`);
    process.exit(2);
  }
  if (cmd === "mcp") {
    const calls = mcpCalls(root);
    const failed = calls.filter((x) => x.payload?.error);
    for (const x of failed) console.error(`unparsed tool result in ${x.file}: ${x.payload.error}`);
    const { rows, sessions } = backfill(calls);
    const stored = store(out, rows, sessions);
    process.exit(report(stored).mismatches.length ? 1 : 0);
  } else if (cmd === "transcript") {
    if (values.all && values.id) {
      console.error("--id names one session; it cannot be given with --all.");
      process.exit(2);
    }
    const remote = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
    const environment = values.environment ?? (remote ? "anthropic_cloud" : "laptop");
    const { readdirSync, statSync } = await import("node:fs");
    const targets = [];
    for (const proj of readdirSync(root)) {
      const dir = join(root, proj);
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const uuid = f.slice(0, -6);
        if (values.all || uuid === (values.session ?? process.env.CLAUDE_CODE_SESSION_ID))
          targets.push({ dir, uuid });
      }
    }
    if (!targets.length) {
      console.error(`No transcript found under ${root}.`);
      process.exit(2);
    }
    const rows = [];
    for (const { dir, uuid } of targets) {
      const t = readSessionTranscripts(dir, uuid);
      const first = t.main.slice(0, 4096).match(/"timestamp":"([^"]+)"/)?.[1] ?? "";
      const id = transcriptId(uuid, process.env, values);
      rows.push(
        ...transcriptRows({ id, created_at: first, environment }, t, new Date().toISOString()),
      );
    }
    const stored = store(out, rows, []);
    console.log(
      `${targets.length} session(s), ${rows.length} rows merged into ${join(out, "ledger.csv")}.`,
    );
    report(stored);
  } else if (cmd === "stale") {
    const listed = listedSessions(mcpCalls(root));
    for (const id of staleSessions(listed, read(join(out, "sessions.csv")))) console.log(id);
  } else if (cmd === "check") {
    if (!existsSync(join(out, "ledger.csv"))) {
      console.error(`No ledger at ${join(out, "ledger.csv")}.`);
      process.exit(2);
    }
    process.exit(
      report({ rows: read(join(out, "ledger.csv")), sessions: read(join(out, "sessions.csv")) })
        .mismatches.length
        ? 1
        : 0,
    );
  } else {
    console.log(HELP);
    process.exit(2);
  }
}
