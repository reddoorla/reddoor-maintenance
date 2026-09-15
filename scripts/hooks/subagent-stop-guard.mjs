#!/usr/bin/env node
// SubagentStop hook: a worker cannot stop with a dirty or unpushed worktree.
//
// Worker subagents in this repo do their work in a git worktree under
// `.claude/worktrees/`, commit, push, and open a PR. When one stops with uncommitted
// changes, or with commits on a branch that was never pushed, the stop is SILENT: the
// parent's tool_result says the agent returned, nothing says the work never left the
// machine, and it sits there until a human happens to run `git worktree list`.
//
// This hook refuses that stop. It reads the subagent's own transcript, finds the
// worktrees the subagent actually touched, asks git about each one, and — if any is
// dirty or unpushed — returns `decision: "block"` with a reason naming them. The
// subagent gets another turn with that reason as its next instruction.
//
// It never modifies anything. Every git call it makes is a read.
//
// ─── how it is wired ─────────────────────────────────────────────────────────────────
// This entry SHIPS in the repo's tracked .claude/settings.json (tracked since decision
// A9, #788), so it is reviewed rather than pasted. Reproduced here so the script says
// how it is called:
//
//   "hooks": {
//     "SubagentStop": [
//       {
//         "matcher": "*",
//         "hooks": [
//           {
//             "type": "command",
//             "command": "node scripts/hooks/subagent-stop-guard.mjs"
//           }
//         ]
//       }
//     ]
//   }
//
// `"*"` is the documented match-all matcher; SubagentStop's matcher filters on
// `agent_type`, and every agent type that can be given a worktree is in scope.
// ─────────────────────────────────────────────────────────────────────────────────────
//
// CONTRACT (docs.claude.com/en/docs/claude-code/hooks §SubagentStop and §Stop decision
// control, read 2026-09-15 from the fetched corpus, not from memory):
//   stdin   {"session_id", "transcript_path", "cwd", "permission_mode",
//            "hook_event_name": "SubagentStop", "stop_hook_active": bool, "agent_id",
//            "agent_type", "agent_transcript_path", "last_assistant_message", …}
//           `transcript_path` is the MAIN session's transcript; `agent_transcript_path`
//           is the subagent's own, under a nested `subagents/` folder.
//   stdout  {"decision":"block","reason":"…"} keeps the subagent running and delivers
//           `reason` to it as its next instruction. Omitting `decision` (here: printing
//           nothing at all) allows the stop.
//   exit 0  always. A guard that fails must never strand a subagent in a loop; anything
//           this script cannot do, it says on stderr and allows the stop.
//
// THE LOOP GUARD. `stop_hook_active` is true when the subagent is ALREADY continuing
// because of a previous block. A hook that blocks again in that state loops until Claude
// Code's 8-continuation cap cuts it off. So that check is first, before any IO: if the
// subagent has already been told once and still chose to stop, that is its call to make.
//
// Usage outside the harness (this is how its proof is run):
//   echo '{"hook_event_name":"SubagentStop","stop_hook_active":false,"cwd":"…",
//          "agent_transcript_path":"…"}' | node scripts/hooks/subagent-stop-guard.mjs
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";

// Short by design: three reads against a local worktree are milliseconds, and a git call
// that has not answered in two seconds is a stuck index or a network remote, neither of
// which this hook should wait on. A timeout throws, which lands in "cannot tell".
const GIT_TIMEOUT_MS = 2000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_PATHS_IN_REASON = 5;

// ── stdin ────────────────────────────────────────────────────────────────────────────

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf-8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// ── shell parsing ────────────────────────────────────────────────────────────────────

/**
 * A Bash command string, split into segments at the shell operators that end a command
 * (`;`, newline, `&`, `|`, parens) and each segment split into tokens, honouring single
 * quotes, double quotes and backslash escapes.
 *
 * This is deliberately not a shell: it does no expansion, no substitution and no
 * redirection handling. It exists only so that `cd "/a path/with spaces"` yields one
 * token and `git worktree add x && rm -rf y` does not put `rm` in the `add` segment.
 */
export function lex(command) {
  const segments = [];
  let segment = [];
  let token = "";
  let started = false;
  let quote = "";
  const endToken = () => {
    if (started) segment.push(token);
    token = "";
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (segment.length > 0) segments.push(segment);
    segment = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < command.length) {
        token += command[++i];
        started = true;
      } else {
        token += c;
        started = true;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      token += command[++i];
      started = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endToken();
      continue;
    }
    if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      endSegment();
      continue;
    }
    token += c;
    started = true;
  }
  endSegment();
  return segments;
}

/**
 * The path-shaped arguments of one command segment that could name a worktree: the
 * argument of `cd`, and every argument after `git … worktree … add`.
 *
 * `git worktree add` takes its arguments in either order (`add <path> -b <branch>` and
 * `add -b <branch> <path>` are both valid), so rather than model the flag grammar this
 * returns ALL of them and lets the caller keep only the ones that resolve under
 * `.claude/worktrees/`. A branch name such as `feat/x` resolves to `<repo>/feat/x` and
 * is dropped there, so the loose collection costs nothing.
 */
export function candidateTokens(segment) {
  const out = [];
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] !== "cd") continue;
    for (let j = i + 1; j < segment.length; j++) {
      const next = segment[j];
      if (next === undefined) break;
      if (next.startsWith("-")) continue;
      out.push(next);
      break;
    }
  }
  const gitAt = segment.indexOf("git");
  if (gitAt !== -1) {
    const worktreeAt = segment.indexOf("worktree", gitAt + 1);
    if (worktreeAt !== -1) {
      const addAt = segment.indexOf("add", worktreeAt + 1);
      if (addAt !== -1) {
        for (let j = addAt + 1; j < segment.length; j++) {
          const t = segment[j];
          if (t !== undefined) out.push(t);
        }
      }
    }
  }
  return out.filter((t) => t.length > 0);
}

// ── paths ────────────────────────────────────────────────────────────────────────────

/** realpath where it resolves, the input where it does not — so both sides of a compare
 *  agree on macOS, where $TMPDIR is a symlink into /private/var. */
function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isStrictlyUnder(parent, child) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * The main repository's root, given any directory inside it. `--git-common-dir` is the
 * point: from a LINKED worktree it returns the MAIN repo's `.git`, so a hook that runs
 * with its cwd inside a worktree still finds `<repo>/.claude/worktrees`, not
 * `<worktree>/.claude/worktrees`.
 */
function repoRootOf(cwd) {
  const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return realOrSelf(dirname(out.trim()));
}

// ── the transcript ───────────────────────────────────────────────────────────────────

/**
 * Every distinct worktree under `<repoRoot>/.claude/worktrees/` that a Bash call in this
 * transcript names, in the order they were first seen.
 *
 * The line prefilter is the literal `worktree`: a `git worktree add` carries it as a
 * subcommand and any path under `.claude/worktrees/` carries it in the path, so a line
 * without it cannot name a worktree by either route this hook understands. It is what
 * keeps a multi-megabyte transcript under the budget — JSON.parse runs on a handful of
 * lines rather than all of them.
 */
export async function worktreesInTranscript(transcriptPath, repoRoot) {
  const worktreesRoot = join(repoRoot, ".claude", "worktrees");
  const found = new Map();
  const rl = createInterface({
    input: createReadStream(transcriptPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.includes("worktree")) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== "tool_use" || block.name !== "Bash") continue;
      const command = block.input?.command;
      if (typeof command !== "string") continue;
      for (const segment of lex(command)) {
        for (const token of candidateTokens(segment)) {
          const abs = realOrSelf(isAbsolute(token) ? token : resolve(repoRoot, token));
          if (!isStrictlyUnder(worktreesRoot, abs)) continue;
          if (!found.has(abs)) found.set(abs, true);
        }
      }
    }
  }
  return [...found.keys()];
}

// ── git ──────────────────────────────────────────────────────────────────────────────

function git(worktree, args) {
  return execFileSync("git", ["-C", worktree, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `XY path` in porcelain v1; a rename is `R  old -> new` and the new name is the one
 *  that matters to whoever has to pick the work up. */
function porcelainPath(line) {
  const rest = line.slice(3);
  const arrow = rest.lastIndexOf(" -> ");
  return arrow === -1 ? rest : rest.slice(arrow + 4);
}

/**
 * One worktree's verdict: `{ kind: "dirty" | "unpushed" | "clean" | "unknown" }`.
 *
 * "unknown" is a git call that errored — a corrupt index, a locked repo, a missing
 * `origin/main`, a timeout. A guard that cannot measure must not accuse: unknown
 * contributes nothing to the block and is reported on stderr instead, where the operator
 * sees it and the subagent does not.
 */
export function inspectWorktree(worktree) {
  let status;
  try {
    status = git(worktree, ["status", "--porcelain"]);
  } catch (e) {
    return { kind: "unknown", why: `git status failed: ${e.message}` };
  }
  const changed = status.split("\n").filter((l) => l.trim().length > 0);
  if (changed.length > 0) {
    return { kind: "dirty", count: changed.length, paths: changed.map(porcelainPath) };
  }

  // An upstream means the branch has been pushed at least once, and this first version
  // asks no more than that. `@{u}` failing IS the signal, not an error — a branch with no
  // upstream, and a detached HEAD, both land here.
  try {
    git(worktree, ["rev-parse", "--abbrev-ref", "@{u}"]);
    return { kind: "clean" };
  } catch {
    /* no upstream — fall through to the ahead-of-main count */
  }

  let ahead;
  try {
    ahead = Number(git(worktree, ["rev-list", "origin/main..HEAD", "--count"]).trim());
  } catch (e) {
    return { kind: "unknown", why: `git rev-list failed: ${e.message}` };
  }
  if (!Number.isFinite(ahead)) return { kind: "unknown", why: "git rev-list returned no number" };
  return ahead > 0 ? { kind: "unpushed", count: ahead } : { kind: "clean" };
}

// ── the reason ───────────────────────────────────────────────────────────────────────

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function reasonLine(worktree, verdict) {
  if (verdict.kind === "dirty") {
    const shown = verdict.paths.slice(0, MAX_PATHS_IN_REASON);
    const more = verdict.paths.length > MAX_PATHS_IN_REASON ? ", …" : "";
    return `${worktree} — ${plural(verdict.count, "uncommitted change")}: ${shown.join(", ")}${more}`;
  }
  return (
    `${worktree} — ${plural(verdict.count, "commit")} with no upstream — ` +
    `push and open the PR, or say why not`
  );
}

// ── main ─────────────────────────────────────────────────────────────────────────────

const say = (msg) => process.stderr.write(`subagent-stop-guard: ${msg}\n`);

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return say("no hook JSON on stdin");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return say("stdin is not JSON");
  }

  // 1. THE LOOP GUARD, first and before any IO. The subagent has already been blocked
  //    once and is continuing because of it; blocking again is how a hook loops.
  if (input.stop_hook_active === true) return;

  // 2. The worktrees this subagent named.
  const transcript =
    typeof input.agent_transcript_path === "string" && input.agent_transcript_path
      ? input.agent_transcript_path
      : typeof input.transcript_path === "string"
        ? input.transcript_path
        : "";
  if (!transcript) return say("no agent_transcript_path or transcript_path in the hook JSON");
  if (!existsSync(transcript)) return say(`transcript does not exist: ${transcript}`);

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  let repoRoot;
  try {
    repoRoot = repoRootOf(cwd);
  } catch (e) {
    return say(`cannot tell where the repo is from ${cwd}: ${e.message}`);
  }

  let worktrees;
  try {
    worktrees = await worktreesInTranscript(transcript, repoRoot);
  } catch (e) {
    return say(`cannot read the transcript ${transcript}: ${e.message}`);
  }
  if (worktrees.length === 0) return;

  // 3. Ask git about each one that is still on disk. Read-only, every call.
  const lines = [];
  for (const worktree of worktrees) {
    let onDisk;
    try {
      onDisk = statSync(worktree).isDirectory();
    } catch {
      onDisk = false;
    }
    if (!onDisk) continue;
    const verdict = inspectWorktree(worktree);
    if (verdict.kind === "unknown") {
      say(`cannot tell about ${worktree}: ${verdict.why} — allowing`);
      continue;
    }
    if (verdict.kind === "clean") continue;
    lines.push(reasonLine(worktree, verdict));
  }

  // 4. Block, or say nothing at all.
  if (lines.length === 0) return;
  const reason = [
    "You cannot stop yet: work you did is still stranded in a worktree.",
    ...lines,
  ].join("\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
}

main().catch((e) => {
  // Never strand a subagent over a guard. Allow the stop and say why on stderr.
  say(e.message);
});
