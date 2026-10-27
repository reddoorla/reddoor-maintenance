#!/usr/bin/env node
// The per-model usage ledger (P1-83). Writes `results.jsonl` (the stored result events),
// `messages.jsonl` (the stored transcript messages), `sessions.csv` and `ledger.csv` in the
// workspace's private `usage/` folder; see this directory's README for the commands.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  COLUMNS,
  SESSION_COLUMNS,
  formatReport,
  ingest,
  listedSessions,
  mcpCalls,
  parseCsv,
  readSessionTranscripts,
  reconcile,
  staleSessions,
  toCsv,
  transcriptId,
  transcriptMessages,
  weeklyReport,
} from "./lib/usage.mjs";

const read = (p) => (existsSync(p) ? parseCsv(readFileSync(p, "utf8")) : []);
const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l, i) => {
          try {
            return JSON.parse(l);
          } catch {
            throw new Error(
              `${p}:${i + 1} is not JSON; restore the file from git before harvesting.`,
            );
          }
        })
    : [];

/** Write through a temporary file and a rename, so a crash never leaves half a file. */
function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** One harvest into `<out>`: results.jsonl, sessions.csv and ledger.csv, rebuilt together. */
function store(out, harvest) {
  mkdirSync(out, { recursive: true });
  const paths = {
    results: join(out, "results.jsonl"),
    messages: join(out, "messages.jsonl"),
    sessions: join(out, "sessions.csv"),
    rows: join(out, "ledger.csv"),
  };
  const done = ingest(
    {
      results: readJsonl(paths.results),
      messages: readJsonl(paths.messages),
      sessions: read(paths.sessions),
      rows: read(paths.rows),
    },
    harvest,
  );
  writeAtomic(paths.results, done.results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (done.messages.length)
    writeAtomic(paths.messages, done.messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  writeAtomic(paths.sessions, toCsv(done.sessions, SESSION_COLUMNS));
  writeAtomic(paths.rows, toCsv(done.rows, COLUMNS));
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
  // modelUsage plus its residual is the server's total; transcript rows are a split of it.
  console.log(
    "\nTotals by source. modelUsage plus get_session-residual is the cloud total; transcript rows are inside it, so never add them to it.",
  );
  const bySource = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + Number(r.cost_usd);
  for (const [source, v] of Object.entries(bySource)) console.log(`  ${source}: ${usd(v)}`);
  const cov = {};
  for (const s of sessions) cov[s.coverage] = (cov[s.coverage] ?? 0) + 1;
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
  check       Reconcile each stored run's modelUsage rows with its result total, within half a cent.
  report      The weekly summary of the stored ledger for rows whose as_of is in [--since, --until)
              (ISO times; default the 7 days before now): cloud spend by model, the top 5 sessions,
              main thread against subagents, and Opus cost by token class. Its first line is the
              one the Monday PM pass copies.`;

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      root: { type: "string" },
      session: { type: "string" },
      id: { type: "string" },
      environment: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      all: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const [cmd] = positionals;
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!cmd || !values.out) {
    console.log(HELP);
    process.exit(cmd ? 2 : 0);
  }
  const out = resolve(values.out);
  const root = resolve(
    values.root ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects"),
  );
  if (cmd !== "check" && cmd !== "report" && !existsSync(root)) {
    console.error(`No transcript root at ${root}.`);
    process.exit(2);
  }
  if (cmd === "mcp") {
    const calls = mcpCalls(root);
    const failed = calls.filter((x) => x.payload?.error);
    for (const x of failed) console.error(`unparsed tool result in ${x.file}: ${x.payload.error}`);
    const stored = store(out, { calls });
    process.exit(report(stored).mismatches.length ? 1 : 0);
  } else if (cmd === "transcript") {
    if (values.all && (values.id || values.session)) {
      console.error("--id and --session name one session; neither can be given with --all.");
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
    // Each session's fullest copy is read first, so a new message found in several files is owned
    // by the fullest; a message already stored keeps its owner (mergeMessages).
    const copies = targets.map(({ dir, uuid }) => ({ uuid, t: readSessionTranscripts(dir, uuid) }));
    copies.sort((a, b) => b.t.main.length - a.t.main.length);
    const messages = [];
    for (const { uuid, t } of copies) {
      const first = t.main.slice(0, 4096).match(/"timestamp":"([^"]+)"/)?.[1] ?? "";
      const id = transcriptId(uuid, process.env, values);
      messages.push(...transcriptMessages({ id, created_at: first, environment }, t));
    }
    const stored = store(out, { messages });
    console.log(
      `${targets.length} session(s), ${messages.length} messages merged into ${join(out, "messages.jsonl")}.`,
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
  } else if (cmd === "report") {
    // A time needs its zone: without one, Date.parse reads it as the machine's local time.
    const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
    // Date.parse rolls 2026-02-30 over to March; a real date reads back as itself.
    const real = (t) =>
      Number.isFinite(Date.parse(t)) &&
      new Date(Date.parse(t.slice(0, 10))).toISOString().slice(0, 10) === t.slice(0, 10);
    for (const k of ["since", "until"])
      if (values[k] !== undefined && (!ISO.test(values[k]) || !real(values[k]))) {
        console.error(
          `--${k} ${values[k]} is not a real date, or an ISO time with a zone, like 2026-01-08 or 2026-01-08T00:00Z.`,
        );
        process.exit(2);
      }
    const until = values.until ?? new Date().toISOString();
    if (values.since && Date.parse(values.since) >= Date.parse(until)) {
      console.error(`--since ${values.since} is not before --until ${until}.`);
      process.exit(2);
    }
    if (!existsSync(join(out, "ledger.csv"))) {
      console.error(`No ledger at ${join(out, "ledger.csv")}.`);
      process.exit(2);
    }
    const r = weeklyReport(
      { rows: read(join(out, "ledger.csv")), sessions: read(join(out, "sessions.csv")) },
      { since: values.since, until },
    );
    console.log(formatReport(r));
  } else {
    console.log(HELP);
    process.exit(2);
  }
}
