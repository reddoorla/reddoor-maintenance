#!/usr/bin/env node
// SessionStart hook: two failures that are silent from inside a session.
//
// (a) A STALE MAIN CHECKOUT. A session loads tracked project settings — `.claude/settings.json`,
//     its hooks, rules — from the MAIN checkout, even when it works in a worktree. On
//     2026-09-15 a hook merged to main did not run in a live control because the operator's
//     main checkout had not pulled, and nothing said so. This hook compares the main
//     checkout's HEAD with `origin/main` AS OF THE LAST FETCH (it never fetches: no network,
//     and a SessionStart hook must be fast) and warns only when a session-config path
//     differs. Behind on docs alone is the normal state of a busy repo and says nothing.
//
// (b) AN OVERFULL MEMORY INDEX. Claude Code loads the first 200 lines or 25KB of the
//     project's auto-memory `MEMORY.md`, whichever comes first; the rest is silently not
//     loaded (docs: memory.md, "The first 200 lines of MEMORY.md, or the first 25KB,
//     whichever comes first, are loaded at the start of every conversation"). This hook
//     warns at 80% — 160 lines or 20,000 bytes — while there is still room to prune.
//
// Read-only, no network, always exit 0, silent when nothing is wrong.
//
// ─── how it is wired ─────────────────────────────────────────────────────────────────
// A second SessionStart entry in the tracked .claude/settings.json, beside the
// `resume|compact` orphaned-agents report:
//
//   {
//     "matcher": "startup|resume",
//     "hooks": [{ "type": "command", "command": "node scripts/hooks/session-start-checks.mjs" }]
//   }
//
// Note the irony it cannot escape: this hook ships in tracked settings, so a main checkout
// that has not pulled the commit adding it does not run it either. It catches every LATER
// staleness, not its own arrival.
// ─────────────────────────────────────────────────────────────────────────────────────
//
// CONTRACT (hooks.md §SessionStart and §JSON output, read 2026-09-17 from the fetched
// corpus, not from memory):
//   stdin   {"session_id", "transcript_path", "cwd", "hook_event_name": "SessionStart",
//            "source": "startup"|"resume"|"clear"|"compact"|"fork", …}
//   stdout  {"systemMessage": "…", "hookSpecificOutput": {"hookEventName": "SessionStart",
//            "additionalContext": "…"}}
//           `additionalContext` reaches Claude. `systemMessage` is the universal "Warning
//           message shown to the user"; the SessionStart section lists no exception for it
//           (the events that discard it — Setup, SessionEnd, PreCompact, … — each say so),
//           and its input table suggests reporting resume cost "in a systemMessage". So the
//           same text goes to both: the operator is the one who has to pull or prune.
//   exit 0  always. Anything this script cannot do, it says on stderr (debug log only).
//
// Environment:
//   CLAUDE_PROJECTS_DIR   the directory holding per-project folders; default
//                         $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects. Tests set it.
//
// Usage outside the harness:
//   echo '{"hook_event_name":"SessionStart","source":"startup","cwd":"…"}' \
//     | node scripts/hooks/session-start-checks.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const GIT_TIMEOUT_MS = 1500;

const SESSION_CONFIG_PATHS = [
  ".claude/settings.json",
  ".claude/rules",
  ".claude/workflows",
  ".claude/hooks",
  "CLAUDE.md",
  "AUTONOMY.md",
  "scripts/hooks",
];

const MEMORY_LIMIT_LINES = 200;
const MEMORY_LIMIT_BYTES = 25_000;
const MEMORY_WARN_LINES = 160;
const MEMORY_WARN_BYTES = 20_000;

const say = (msg) => process.stderr.write(`session-start-checks: ${msg}\n`);

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** The main checkout's root from any directory in the repo or one of its worktrees, or ""
 *  when `cwd` is not in a git repo with an ordinary `.git` directory. */
function mainCheckoutOf(cwd) {
  let common;
  try {
    common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  } catch {
    return "";
  }
  if (basename(common) !== ".git") return "";
  return realOrSelf(dirname(common));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ── (a) the stale main checkout ──────────────────────────────────────────────────────

function staleMainWarning(main) {
  let branch;
  try {
    branch = git(main, ["symbolic-ref", "--short", "-q", "HEAD"]).trim();
  } catch {
    return ""; // detached: not a checkout the operator pulls
  }
  if (branch !== "main") return "";
  try {
    git(main, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"]);
  } catch {
    return "";
  }
  const behind = Number(git(main, ["rev-list", "--count", "HEAD..origin/main"]).trim());
  if (!Number.isFinite(behind) || behind === 0) return "";
  const changed = git(main, [
    "diff",
    "--name-only",
    "HEAD",
    "origin/main",
    "--",
    ...SESSION_CONFIG_PATHS,
  ])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (changed.length === 0) return "";

  let fetched = "";
  try {
    fetched = ` (last fetch ${statSync(join(main, ".git", "FETCH_HEAD")).mtime.toISOString()})`;
  } catch {
    // never fetched, or FETCH_HEAD elsewhere: the count still stands
  }
  return [
    `STALE MAIN CHECKOUT: ${main} is ${plural(behind, "commit")} behind origin/main as of the last fetch${fetched}, and these session-config files differ:`,
    ...changed.map((p) => `  - ${p}`),
    "Sessions load tracked settings, hooks and rules from the MAIN checkout even when they work in a worktree, " +
      "so the hooks and rules on origin/main are NOT live in any session until the operator pulls " +
      `(git -C ${main} pull --ff-only).`,
  ].join("\n");
}

// ── (b) the memory index ─────────────────────────────────────────────────────────────

/** Claude Code's per-project folder name: the path with every non-alphanumeric character
 *  replaced by `-` (so `/Users/x/repo` → `-Users-x-repo`, `.claude` → `-claude`). */
function projectDirName(path) {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

function memoryIndexPath(main) {
  const projects =
    process.env.CLAUDE_PROJECTS_DIR ||
    join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  return join(projects, projectDirName(main), "memory", "MEMORY.md");
}

function memoryWarning(main) {
  const file = memoryIndexPath(main);
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return ""; // no index yet
  }
  const bytes = buf.length;
  const parts = buf.toString("utf-8").split("\n");
  if (parts.at(-1) === "") parts.pop();
  const lines = parts.length;
  if (lines <= MEMORY_WARN_LINES && bytes <= MEMORY_WARN_BYTES) return "";
  return [
    `MEMORY INDEX NEAR ITS LOAD LIMIT: ${file} is ${lines} lines / ${bytes.toLocaleString("en-US")} bytes.`,
    `Claude Code loads only the first ${MEMORY_LIMIT_LINES} lines or ${MEMORY_LIMIT_BYTES.toLocaleString("en-US")} bytes, whichever comes first; ` +
      "entries past that limit are silently not loaded into any session. " +
      `This warns at 80% (${MEMORY_WARN_LINES} lines / ${MEMORY_WARN_BYTES.toLocaleString("en-US")} bytes): ` +
      "keep one line per entry, move detail into topic files, merge or drop stale entries.",
  ].join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const raw = await readStdin();
  let input = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      return say("stdin is not JSON");
    }
  }
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const checkout = mainCheckoutOf(cwd);
  if (!checkout) return; // not a git repo: nothing to check, and nothing wrong

  const warnings = [];
  for (const check of [staleMainWarning, memoryWarning]) {
    try {
      const w = check(checkout);
      if (w) warnings.push(w);
    } catch (e) {
      say(`${check.name} could not measure: ${e.message}`);
    }
  }
  if (warnings.length === 0) return;

  const text = warnings.join("\n\n");
  process.stdout.write(
    JSON.stringify({
      systemMessage: text,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    }) + "\n",
  );
}

main().catch((e) => {
  // Never fail a session start over a check.
  say(e.message);
});
