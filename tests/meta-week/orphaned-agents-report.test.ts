import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The SessionStart hook's stdin → stdout contract, exercised end to end against fixture
 * transcripts: the script reads the hook JSON on stdin, runs the census's orphaned-agent
 * detector over THAT session only, and either prints the hook output JSON or prints
 * nothing at all.
 *
 * Fixtures follow tests/meta-week/census.test.ts — the same record shapes, and the same
 * rule that the session's directory is NAMED for the session, because that is the layout
 * `--session` prefilters on.
 *
 * Root layout:
 *   -Users-x-Documents-GitHub-theta/
 *     sess-orphan.jsonl            three Agent dispatches
 *     sess-orphan/subagents/       k1 quota-rejected (re-sent as k2), k2 ok, k3 interrupted
 *     sess-clean.jsonl             one Agent dispatch that came back
 *     sess-clean/subagents/        c1 ok
 */

const HOOK = fileURLToPath(
  new URL("../../scripts/hooks/orphaned-agents-report.mjs", import.meta.url),
);
const CWD = "/Users/x/Documents/GitHub/theta";
const T = (hms: string) => `2026-09-04T${hms}Z`;
let n = 0;
const uid = (p: string) => `${p}-${++n}`;

type Block = Record<string, unknown>;

function assistant(o: {
  ts: string;
  sessionId: string;
  requestId: string;
  out: number;
  blocks: Block[];
  sidechain?: boolean;
  agentId?: string;
}): string {
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: uid("a"),
    requestId: o.requestId,
    timestamp: o.ts,
    sessionId: o.sessionId,
    isSidechain: o.sidechain ?? false,
    cwd: CWD,
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: o.blocks,
      usage: {
        input_tokens: 1,
        output_tokens: o.out,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  if (o.sidechain) {
    rec.agentId = o.agentId;
    rec.attributionAgent = "general-purpose";
  }
  return JSON.stringify(rec);
}

const text = (t: string): Block => ({ type: "text", text: t });
const agentCall = (id: string, prompt: string): Block => ({
  type: "tool_use",
  id,
  name: "Agent",
  input: { subagent_type: "general-purpose", model: "sonnet", prompt },
});

/** The record an account-limit kill leaves as a subagent transcript's last line. */
function quotaRejected(o: { ts: string; sessionId: string; agentId: string }): string {
  return JSON.stringify({
    type: "assistant",
    uuid: uid("a"),
    requestId: "",
    timestamp: o.ts,
    sessionId: o.sessionId,
    isSidechain: true,
    agentId: o.agentId,
    attributionAgent: "general-purpose",
    cwd: CWD,
    quotaLimits: { status: "rejected", rateLimitType: "five_hour" },
    message: {
      role: "assistant",
      model: "claude-fable-5",
      stop_reason: "stop_sequence",
      content: [{ type: "text", text: "You've hit your session limit · resets 2pm" }],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

/** The other kill shape: a turn the agent never answered. */
function interruptedTail(o: { ts: string; sessionId: string; agentId: string }): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: o.sessionId,
    isSidechain: true,
    agentId: o.agentId,
    cwd: CWD,
    message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
  });
}

let root: string;

async function writeSession(
  sessionId: string,
  parent: string[],
  subagents: Record<string, string[]>,
  metas: Record<string, Record<string, unknown>>,
) {
  const dir = join(root, "-Users-x-Documents-GitHub-theta");
  await mkdir(join(dir, sessionId, "subagents"), { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), parent.join("\n") + "\n");
  for (const [id, lines] of Object.entries(subagents)) {
    await writeFile(
      join(dir, sessionId, "subagents", `agent-${id}.jsonl`),
      lines.join("\n") + "\n",
    );
  }
  for (const [id, meta] of Object.entries(metas)) {
    await writeFile(
      join(dir, sessionId, "subagents", `agent-${id}.meta.json`),
      JSON.stringify(meta),
    );
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "orphan-hook-"));

  await writeSession(
    "sess-orphan",
    [
      assistant({
        ts: T("10:00:00"),
        sessionId: "sess-orphan",
        requestId: "r1",
        out: 5,
        blocks: [agentCall("t1", "review the security lens")],
      }),
      assistant({
        ts: T("11:00:00"),
        sessionId: "sess-orphan",
        requestId: "r2",
        out: 5,
        blocks: [agentCall("t2", "review the security lens")],
      }),
      assistant({
        ts: T("12:00:00"),
        sessionId: "sess-orphan",
        requestId: "r3",
        out: 5,
        blocks: [agentCall("t3", "walk the fleet table")],
      }),
    ],
    {
      k1: [
        assistant({
          ts: T("10:00:10"),
          sessionId: "sess-orphan",
          requestId: "k1a",
          out: 100,
          blocks: [text("reading")],
          sidechain: true,
          agentId: "k1",
        }),
        quotaRejected({ ts: T("10:02:00"), sessionId: "sess-orphan", agentId: "k1" }),
      ],
      k2: [
        assistant({
          ts: T("11:00:10"),
          sessionId: "sess-orphan",
          requestId: "k2a",
          out: 70,
          blocks: [text("lens report")],
          sidechain: true,
          agentId: "k2",
        }),
      ],
      k3: [
        assistant({
          ts: T("12:00:10"),
          sessionId: "sess-orphan",
          requestId: "k3a",
          out: 33,
          blocks: [text("started")],
          sidechain: true,
          agentId: "k3",
        }),
        interruptedTail({ ts: T("12:01:00"), sessionId: "sess-orphan", agentId: "k3" }),
      ],
    },
    {
      k1: {
        agentType: "general-purpose",
        description: "Review #569: security lens",
        toolUseId: "t1",
        spawnDepth: 1,
      },
      k2: {
        agentType: "general-purpose",
        description: "Review #569: security lens",
        toolUseId: "t2",
        spawnDepth: 1,
      },
      k3: {
        agentType: "Explore",
        description: "Walk the fleet table",
        toolUseId: "t3",
        spawnDepth: 1,
      },
    },
  );

  await writeSession(
    "sess-clean",
    [
      assistant({
        ts: T("09:00:00"),
        sessionId: "sess-clean",
        requestId: "c0",
        out: 5,
        blocks: [agentCall("u1", "summarise the docs")],
      }),
    ],
    {
      c1: [
        assistant({
          ts: T("09:00:10"),
          sessionId: "sess-clean",
          requestId: "c1a",
          out: 40,
          blocks: [text("summary")],
          sidechain: true,
          agentId: "c1",
        }),
      ],
    },
    {
      c1: {
        agentType: "general-purpose",
        description: "Summarise the docs",
        toolUseId: "u1",
        spawnDepth: 1,
      },
    },
  );
});

function runHook(stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, "--root", root]);
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

const hookInput = (sessionId: unknown, source = "resume") =>
  JSON.stringify({
    session_id: sessionId,
    transcript_path: `${root}/-Users-x-Documents-GitHub-theta/${String(sessionId)}.jsonl`,
    cwd: CWD,
    hook_event_name: "SessionStart",
    source,
  });

describe("SessionStart hook: the orphaned-agent report", () => {
  it("PASS: takes the session from stdin and reports each orphan and its re-dispatch", async () => {
    const { code, stdout, stderr } = await runHook(hookInput("sess-orphan"));
    expect(stderr).toBe("");
    expect(code).toBe(0);

    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    // The documented SessionStart output contract, spelled exactly.
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");

    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("2 agents in this session were dispatched and never returned");
    // description, agentType, lastStatus and the re-dispatch, for the agent killed by the
    // account limit and re-sent under the same description.
    expect(ctx).toContain('"Review #569: security lens" [general-purpose] — quota-rejected');
    expect(ctx).toContain("already re-dispatched 2026-09-04T11:00:10Z (t2)");
    // The one that was interrupted and never re-sent — the line the session must act on.
    expect(ctx).toContain('"Walk the fleet table" [Explore] — interrupted');
    expect(ctx).toContain("NOT re-dispatched");
    // k2 returned, so it is not itself reported.
    expect(ctx).not.toContain("[general-purpose] — ok");
  });

  it("FAIL control: a session whose agents all returned prints nothing", async () => {
    const { code, stdout, stderr } = await runHook(hookInput("sess-clean"));
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("a session id with no transcripts at all prints nothing", async () => {
    const { code, stdout } = await runHook(hookInput("sess-never-existed"));
    expect(stdout).toBe("");
    expect(code).toBe(0);
  });

  it("matches on source only through the settings matcher, so any source is reported", async () => {
    const { stdout } = await runHook(hookInput("sess-orphan", "compact"));
    expect(stdout).not.toBe("");
  });

  it("never blocks a session start: malformed stdin exits 0 with nothing on stdout", async () => {
    for (const bad of [
      "",
      "not json at all",
      JSON.stringify({ hook_event_name: "SessionStart" }),
    ]) {
      const { code, stdout, stderr } = await runHook(bad);
      expect(stdout).toBe("");
      expect(code).toBe(0);
      // It is quiet on stdout but not silent: the reason goes to stderr, which
      // SessionStart shows to the user and never to Claude.
      expect(stderr).not.toBe("");
    }
  });
});
