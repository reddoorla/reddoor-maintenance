#!/usr/bin/env node
// SessionStart hook: what died when this session was last blocked or compacted.
//
// R3(a) of docs/superpowers/specs/2026-09-14-operating-model-recommendations.md. The
// largest measured class of wasted work is agents killed in flight by an account limit:
// the parent's tool_result for an async dispatch is written AT LAUNCH, so nothing in the
// resumed conversation says the agent never came back. This hook runs the census's proven
// orphaned-agent detector over THIS session and lists the candidates.
//
// It lists; it does not act. The session decides which orphans still need doing.
//
// ─── the operator applies this; the sandbox denies writing settings.json ─────────────
// Add to reddoor-maintenance/.claude/settings.json (or the operator's local settings):
//
//   "hooks": {
//     "SessionStart": [
//       {
//         "matcher": "resume|compact",
//         "hooks": [
//           {
//             "type": "command",
//             "command": "node scripts/hooks/orphaned-agents-report.mjs"
//           }
//         ]
//       }
//     ]
//   }
//
// `startup` is deliberately not matched: a brand-new session has no agents of its own to
// have lost. `resume|compact` is a valid matcher — SessionStart matchers take `|`
// alternation of the literal source values startup|resume|clear|compact|fork.
// ─────────────────────────────────────────────────────────────────────────────────────
//
// CONTRACT (docs.claude.com/en/docs/claude-code/hooks, read 2026-09-14, not from memory):
//   stdin   {"session_id", "transcript_path", "cwd", "hook_event_name": "SessionStart",
//            "source": "startup"|"resume"|"clear"|"compact"|"fork", …}
//   stdout  {"hookSpecificOutput": {"hookEventName": "SessionStart",
//            "additionalContext": "…"}}  — for SessionStart, additionalContext IS read
//            ("Context only … hookSpecificOutput.additionalContext adds context for
//            Claude"). Plain stdout would also reach Claude for this event; the JSON form
//            is used so the payload is explicit and machine-checkable.
//   exit 0  with empty stdout adds nothing. Anything this script cannot do, it says on
//           stderr and exits 0: a report that fails must never block a session start.
//
// Usage outside the harness (this is how its proof is run):
//   echo '{"session_id":"…","hook_event_name":"SessionStart","source":"resume"}' \
//     | node scripts/hooks/orphaned-agents-report.mjs [--root DIR]
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CENSUS = fileURLToPath(new URL("../meta-week/census.mjs", import.meta.url));

function parseArgs(argv) {
  const o = { root: join(homedir(), ".claude", "projects") };
  for (let i = 0; i < argv.length; i++) {
    // --root exists so the test can point the detector at a fixture corpus.
    if (argv[i] === "--root" && i + 1 < argv.length) o.root = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return o;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** One line per orphan: what it was, how it died, and whether it was already re-sent. */
function formatOrphans(candidates) {
  const lines = candidates.map((c) => {
    const e = c.evidence || {};
    const what = e.description ? `"${e.description}"` : `(no description)`;
    const type = e.agentType || "unknown type";
    const again = e.redispatched
      ? `already re-dispatched ${e.redispatchedAt || "later"} (${e.redispatched})`
      : "NOT re-dispatched";
    return `- ${what} [${type}] — ${e.lastStatus} at ${e.lastAt} — ${again}`;
  });
  const n = candidates.length;
  return [
    `${n} agent${n === 1 ? "" : "s"} in this session ${n === 1 ? "was" : "were"} dispatched and never returned:`,
    "",
    ...lines,
    "",
    "These are candidates, not instructions. An agent killed mid-flight left no result,",
    "so decide which of these still need doing and re-dispatch those by description.",
  ].join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write("orphaned-agents-report: no hook JSON on stdin\n");
    return;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write("orphaned-agents-report: stdin is not JSON\n");
    return;
  }
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (!sessionId) {
    process.stderr.write("orphaned-agents-report: no session_id in the hook JSON\n");
    return;
  }

  let result;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        CENSUS,
        "--root",
        o.root,
        "--class",
        "fanout",
        "--kind",
        "orphaned-agent",
        "--session",
        sessionId,
        "--json",
        "-",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    result = JSON.parse(stdout);
  } catch (e) {
    process.stderr.write(`orphaned-agents-report: the detector failed: ${e.message}\n`);
    return;
  }

  const candidates = result?.classes?.fanout?.candidates ?? [];
  // No orphans is the common case and the quiet one: print nothing at all.
  if (candidates.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: formatOrphans(candidates),
      },
    }) + "\n",
  );
}

main().catch((e) => {
  // Never fail a session start over a report.
  process.stderr.write(`orphaned-agents-report: ${e.message}\n`);
});
