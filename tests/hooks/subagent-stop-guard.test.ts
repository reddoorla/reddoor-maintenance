import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The SubagentStop hook's stdin → stdout contract, exercised end to end against a REAL
 * git repository — a bare `origin`, a main checkout, and three worktrees under
 * `.claude/worktrees/` in the three states the guard has to tell apart. Nothing here is
 * mocked: the verdicts come from the same `git status` / `rev-parse @{u}` /
 * `rev-list origin/main..HEAD` calls the hook makes in the fleet.
 *
 * The transcripts are synthetic, and follow tests/meta-week/orphaned-agents-report.test.ts
 * for record shape — an `assistant` record whose message content holds a `tool_use` block
 * named `Bash`, which is all this hook reads.
 *
 * Layout under the temp root:
 *   origin.git/                       bare remote
 *   repo/                             main checkout, branch main, pushed
 *     .claude/worktrees/wt-clean      committed and pushed, working tree clean
 *     .claude/worktrees/wt-dirty      two uncommitted changes
 *     .claude/worktrees/wt-unpushed   one commit, no upstream
 *   transcripts/*.jsonl               one per case
 */

const HOOK = fileURLToPath(new URL("../../scripts/hooks/subagent-stop-guard.mjs", import.meta.url));

let root: string;
let repo: string;
let transcripts: string;

const wtPath = (name: string) => join(repo, ".claude", "worktrees", name);

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

const git = (cwd: string, ...args: string[]) => run("git", args, cwd);

/** One assistant record carrying a single Bash tool_use — the only shape the hook reads. */
let seq = 0;
function bashRecord(command: string): string {
  seq += 1;
  return JSON.stringify({
    type: "assistant",
    uuid: `a-${seq}`,
    requestId: `r-${seq}`,
    timestamp: "2026-09-15T10:00:00Z",
    sessionId: "sess-guard",
    isSidechain: true,
    agentId: "agent-1",
    attributionAgent: "general-purpose",
    cwd: repo,
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [
        { type: "tool_use", id: `t-${seq}`, name: "Bash", input: { command, description: "work" } },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

/** A decoy: a non-Bash tool_use naming a worktree path. It passes the line prefilter, so
 *  it proves the hook keys on the TOOL, not on the substring. */
function readRecord(path: string): string {
  seq += 1;
  return JSON.stringify({
    type: "assistant",
    uuid: `a-${seq}`,
    timestamp: "2026-09-15T10:00:00Z",
    sessionId: "sess-guard",
    isSidechain: true,
    agentId: "agent-1",
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "tool_use", id: `t-${seq}`, name: "Read", input: { file_path: path } }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

async function writeTranscript(name: string, lines: string[]): Promise<string> {
  const file = join(transcripts, `${name}.jsonl`);
  await writeFile(file, lines.join("\n") + "\n");
  return file;
}

beforeAll(async () => {
  // realpath, because on macOS $TMPDIR is a symlink into /private/var and git reports the
  // physical path — the hook normalises both sides, and so must the expectations here.
  root = realpathSync(await mkdtemp(join(tmpdir(), "stop-guard-")));
  repo = join(root, "repo");
  transcripts = join(root, "transcripts");
  await mkdir(transcripts, { recursive: true });

  git(root, "init", "--bare", "-b", "main", "origin.git");
  git(root, "init", "-b", "main", "repo");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "README.md"), "seed\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "seed");
  git(repo, "remote", "add", "origin", join(root, "origin.git"));
  git(repo, "push", "-u", "origin", "main");

  // clean + pushed
  git(repo, "worktree", "add", "-b", "feat/clean", wtPath("wt-clean"));
  git(wtPath("wt-clean"), "push", "-u", "origin", "feat/clean");

  // dirty: one modified tracked file, one untracked file
  git(repo, "worktree", "add", "-b", "feat/dirty", wtPath("wt-dirty"));
  await writeFile(join(wtPath("wt-dirty"), "README.md"), "seed\nedited\n");
  await writeFile(join(wtPath("wt-dirty"), "scratch.txt"), "notes\n");

  // committed, never pushed: clean tree, no upstream, one commit past origin/main
  git(repo, "worktree", "add", "-b", "feat/unpushed", wtPath("wt-unpushed"));
  await writeFile(join(wtPath("wt-unpushed"), "feature.txt"), "done\n");
  git(wtPath("wt-unpushed"), "add", "feature.txt");
  git(wtPath("wt-unpushed"), "commit", "-m", "feat: the work");
});

function runHook(stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { cwd: repo });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const hookInput = (agentTranscript: string, stopHookActive = false) =>
  JSON.stringify({
    session_id: "sess-guard",
    transcript_path: join(transcripts, "main.jsonl"),
    agent_transcript_path: agentTranscript,
    cwd: repo,
    permission_mode: "default",
    hook_event_name: "SubagentStop",
    stop_hook_active: stopHookActive,
    agent_id: "agent-1",
    agent_type: "general-purpose",
    last_assistant_message: "Done.",
  });

function blockReason(stdout: string): string {
  const out = JSON.parse(stdout) as { decision?: string; reason?: string };
  expect(Object.keys(out).sort()).toEqual(["decision", "reason"]);
  expect(out.decision).toBe("block");
  return out.reason ?? "";
}

describe("SubagentStop hook: a worker cannot stop with a dirty or unpushed worktree", () => {
  it("PASS control (a): a clean, pushed worktree prints nothing and allows the stop", async () => {
    const t = await writeTranscript("clean", [
      bashRecord(`git worktree add -b feat/clean ${wtPath("wt-clean")}`),
      bashRecord(`cd ${wtPath("wt-clean")} && git push -u origin feat/clean`),
    ]);
    const { code, stdout, stderr } = await runHook(hookInput(t));
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(code).toBe(0);

    // Prove the instrument before trusting its verdict: a hook that silently failed to
    // find the worktree at all would print exactly the same nothing. Same transcript,
    // same path, one stray file — if it does not block now, the silence above meant
    // nothing.
    await writeFile(join(wtPath("wt-clean"), "stray.txt"), "x\n");
    try {
      const dirtied = await runHook(hookInput(t));
      expect(blockReason(dirtied.stdout)).toContain(
        `${wtPath("wt-clean")} — 1 uncommitted change: stray.txt`,
      );
    } finally {
      await rm(join(wtPath("wt-clean"), "stray.txt"));
    }
    expect((await runHook(hookInput(t))).stdout).toBe("");
  });

  it("(b): a dirty worktree blocks, and the reason names the changed paths", async () => {
    const t = await writeTranscript("dirty", [
      // relative, as a worktree is usually added — the hook resolves it against the repo root
      bashRecord("git worktree add -b feat/dirty .claude/worktrees/wt-dirty"),
      readRecord(join(wtPath("wt-dirty"), "README.md")),
    ]);
    const { code, stdout, stderr } = await runHook(hookInput(t));
    expect(code).toBe(0);
    expect(stderr).toBe("");

    const reason = blockReason(stdout);
    expect(reason).toContain("You cannot stop yet");
    expect(reason).toContain(`${wtPath("wt-dirty")} — 2 uncommitted changes:`);
    expect(reason).toContain("README.md");
    expect(reason).toContain("scratch.txt");
    // one line per worktree, under the single header line
    expect(reason.split("\n")).toHaveLength(2);
  });

  it("(c): a committed branch with no upstream blocks with the unpushed message", async () => {
    const t = await writeTranscript("unpushed", [
      bashRecord(`git worktree add -b feat/unpushed ${wtPath("wt-unpushed")}`),
      // the same worktree named a second way: the set is distinct, so this adds no line
      bashRecord(`cd '${wtPath("wt-unpushed")}' && git commit -am wip`),
    ]);
    const { code, stdout, stderr } = await runHook(hookInput(t));
    expect(code).toBe(0);
    expect(stderr).toBe("");

    const reason = blockReason(stdout);
    expect(reason).toContain(
      `${wtPath("wt-unpushed")} — 1 commit with no upstream — ` +
        `push and open the PR, or say why not`,
    );
    expect(reason).not.toContain("uncommitted");
    expect(reason.split("\n")).toHaveLength(2);
  });

  it("(d) the loop guard: stop_hook_active on the same dirty tree prints nothing", async () => {
    const t = await writeTranscript("dirty-again", [
      bashRecord("git worktree add -b feat/dirty .claude/worktrees/wt-dirty"),
    ]);
    // the control: without the flag this very transcript blocks
    expect((await runHook(hookInput(t))).stdout).not.toBe("");

    const { code, stdout, stderr } = await runHook(hookInput(t, true));
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("(e): a transcript that names no worktree prints nothing", async () => {
    const t = await writeTranscript("no-worktree", [
      // passes the line prefilter but adds nothing: `list` is not `add`
      bashRecord("git worktree list"),
      bashRecord("cd /tmp && ls -la"),
      bashRecord("pnpm exec vitest run tests/hooks"),
    ]);
    const { code, stdout, stderr } = await runHook(hookInput(t));
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("a worktree that has since been removed from disk is skipped, not accused", async () => {
    const t = await writeTranscript("gone", [
      bashRecord("git worktree add -b feat/gone .claude/worktrees/wt-never-existed"),
    ]);
    const { code, stdout } = await runHook(hookInput(t));
    expect(stdout).toBe("");
    expect(code).toBe(0);
  });

  it("never strands a subagent: malformed stdin allows the stop and says why on stderr", async () => {
    for (const bad of [
      "",
      "not json at all",
      JSON.stringify({ hook_event_name: "SubagentStop" }),
    ]) {
      const { code, stdout, stderr } = await runHook(bad);
      expect(stdout).toBe("");
      expect(code).toBe(0);
      expect(stderr).not.toBe("");
    }
  });
});
