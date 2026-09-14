import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CENSUS = fileURLToPath(new URL("../../scripts/meta-week/census.mjs", import.meta.url));

/**
 * Two fixture roots. SEEDED carries exactly one episode of every kind the census can
 * nominate; CLEAN carries the same session shapes with none of them. Every heuristic
 * must find its seed in SEEDED (PASS control) and nothing in CLEAN (FAIL control).
 *
 * Session "s1" (repo alpha), all times UTC on 2026-09-02:
 *   10:00 USER  "build the thing"
 *   10:00:05 ASSISTANT tool_use Read a.ts, Read b.ts, Read c.ts, Edit a.ts       (r1, out 40)
 *   10:05 ASSISTANT tool_use Agent(general-purpose, "audit the forms module for X") (r2, out 10)
 *   10:06 USER  tool_result for r2's Agent → toolUseResult agentId g1 totalTokens 5000
 *   10:10 ASSISTANT tool_use Agent(general-purpose, "audit the forms module for X please") (r3, out 10)  <- duplicate prompt (redo)
 *   10:11 USER  tool_result agentId g2 totalTokens 7000
 *   10:20 system compact_boundary manual preTokens 200000
 *   10:21 ASSISTANT tool_use Read a.ts, Read b.ts, Read c.ts                      (r4, out 30) <- re-read after compaction (redo)
 *   10:30 USER  "stop, kill them"                                                  <- stop request (fanout)
 *   10:31 subagent g3 usage (out 25)                                               <- spend after stop
 *   10:40 USER  "that's wrong, did you actually run it?"                            <- correction (unread); costed from 10:30 prompt
 *   10:35 ASSISTANT text "It is fixed."                                            (r5, out 15) — inside (10:30, 10:40)
 *   11:00 ASSISTANT text "You've hit your session limit · resets 2pm"              <- block
 *   11:03 USER  "hit a session limit continue"                                     <- continue-after-block (fanout)
 *   11:05 ASSISTANT text "continuing"                                              (r6, out 12)
 * Sessions "s2" (repo beta) and "s3" (repo gamma): USER "continue" at 11:03:20 and 11:03:40 → same-turn-many-sessions (fanout)
 *
 * CLEAN: s1 with the reads, one Agent call, no compaction, a polite USER "thanks, looks good", no block.
 */

const CWD = (repo: string) => `/Users/x/Documents/GitHub/${repo}`;
let n = 0;
const uid = (p: string) => `${p}-${++n}`;

function user(o: { ts: string; text: string; sessionId?: string; repo?: string }): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: o.sessionId ?? "s1",
    isSidechain: false,
    cwd: CWD(o.repo ?? "alpha"),
    message: { role: "user", content: o.text },
  });
}

function toolResult(o: {
  ts: string;
  toolUseId: string;
  agentId: string;
  totalTokens: number;
}): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: "s1",
    isSidechain: false,
    cwd: CWD("alpha"),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: o.toolUseId, content: "done" }],
    },
    toolUseResult: { agentId: o.agentId, status: "completed", totalTokens: o.totalTokens },
  });
}

type Block = Record<string, unknown>;
function assistant(o: {
  ts: string;
  requestId: string;
  out: number;
  blocks: Block[];
  sidechain?: boolean;
  agentId?: string;
  sessionId?: string;
  repo?: string;
}): string {
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: uid("a"),
    requestId: o.requestId,
    timestamp: o.ts,
    sessionId: o.sessionId ?? "s1",
    isSidechain: o.sidechain ?? false,
    cwd: CWD(o.repo ?? "alpha"),
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
  return rec && JSON.stringify(rec);
}

const text = (t: string): Block => ({ type: "text", text: t });
const read = (id: string, file: string): Block => ({
  type: "tool_use",
  id,
  name: "Read",
  input: { file_path: file },
});
const edit = (id: string, file: string): Block => ({
  type: "tool_use",
  id,
  name: "Edit",
  input: { file_path: file, old_string: "a", new_string: "b" },
});
const agent = (id: string, prompt: string): Block => ({
  type: "tool_use",
  id,
  name: "Agent",
  input: { subagent_type: "general-purpose", model: "sonnet", prompt },
});

function compaction(ts: string): string {
  return JSON.stringify({
    type: "system",
    subtype: "compact_boundary",
    uuid: uid("c"),
    timestamp: ts,
    sessionId: "s1",
    isSidechain: false,
    cwd: CWD("alpha"),
    content: "Conversation compacted",
    compactMetadata: { trigger: "manual", preTokens: 200000 },
  });
}

const T = (hms: string) => `2026-09-02T${hms}Z`;

let seeded: string;
let clean: string;

async function writeRoot(
  dir: string,
  s1Lines: string[],
  extra: Record<string, string[]>,
  subagents: Record<string, string[]>,
) {
  const alpha = join(dir, "-Users-x-Documents-GitHub-alpha");
  await mkdir(join(alpha, "s1", "subagents"), { recursive: true });
  await writeFile(join(alpha, "s1.jsonl"), s1Lines.join("\n") + "\n");
  for (const [name, lines] of Object.entries(subagents)) {
    await writeFile(join(alpha, "s1", "subagents", `agent-${name}.jsonl`), lines.join("\n") + "\n");
  }
  for (const [repo, lines] of Object.entries(extra)) {
    const d = join(dir, `-Users-x-Documents-GitHub-${repo}`);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, `s-${repo}.jsonl`), lines.join("\n") + "\n");
  }
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "census-"));
  seeded = join(base, "seeded");
  clean = join(base, "clean");

  await writeRoot(
    seeded,
    [
      user({ ts: T("10:00:00"), text: "build the thing" }),
      assistant({
        ts: T("10:00:05"),
        requestId: "r1",
        out: 40,
        blocks: [
          read("t1", "/p/a.ts"),
          read("t2", "/p/b.ts"),
          read("t3", "/p/c.ts"),
          edit("t4", "/p/a.ts"),
        ],
      }),
      assistant({
        ts: T("10:05:00"),
        requestId: "r2",
        out: 10,
        blocks: [agent("t5", "audit the forms module for X")],
      }),
      toolResult({ ts: T("10:06:00"), toolUseId: "t5", agentId: "g1", totalTokens: 5000 }),
      assistant({
        ts: T("10:10:00"),
        requestId: "r3",
        out: 10,
        blocks: [agent("t6", "audit the forms module for X please")],
      }),
      toolResult({ ts: T("10:11:00"), toolUseId: "t6", agentId: "g2", totalTokens: 7000 }),
      compaction(T("10:20:00")),
      assistant({
        ts: T("10:21:00"),
        requestId: "r4",
        out: 30,
        blocks: [read("t7", "/p/a.ts"), read("t8", "/p/b.ts"), read("t9", "/p/c.ts")],
      }),
      user({ ts: T("10:30:00"), text: "stop, kill them" }),
      assistant({ ts: T("10:35:00"), requestId: "r5", out: 15, blocks: [text("It is fixed.")] }),
      user({ ts: T("10:40:00"), text: "that's wrong, did you actually run it?" }),
      assistant({
        ts: T("11:00:00"),
        requestId: "rb",
        out: 0,
        blocks: [text("You've hit your session limit · resets 2pm (America/Los_Angeles)")],
      }),
      user({ ts: T("11:03:00"), text: "hit a session limit continue" }),
      assistant({ ts: T("11:05:00"), requestId: "r6", out: 12, blocks: [text("continuing")] }),
    ],
    {
      beta: [
        user({
          ts: T("11:03:20"),
          text: "hit a session limit continue",
          sessionId: "s2",
          repo: "beta",
        }),
      ],
      gamma: [
        user({
          ts: T("11:03:40"),
          text: "hit a session limit continue",
          sessionId: "s3",
          repo: "gamma",
        }),
      ],
    },
    {
      g3: [
        assistant({
          ts: T("10:31:00"),
          requestId: "rs1",
          out: 25,
          blocks: [text("still going")],
          sidechain: true,
          agentId: "g3",
        }),
      ],
    },
  );

  await writeRoot(
    clean,
    [
      user({ ts: T("10:00:00"), text: "build the thing" }),
      assistant({
        ts: T("10:00:05"),
        requestId: "c1",
        out: 40,
        blocks: [read("k1", "/p/a.ts"), read("k2", "/p/b.ts"), edit("k3", "/p/a.ts")],
      }),
      assistant({
        ts: T("10:05:00"),
        requestId: "c2",
        out: 10,
        blocks: [agent("k4", "audit the forms module for X")],
      }),
      toolResult({ ts: T("10:06:00"), toolUseId: "k4", agentId: "h1", totalTokens: 5000 }),
      user({ ts: T("10:30:00"), text: "thanks, looks good" }),
      assistant({ ts: T("10:35:00"), requestId: "c3", out: 15, blocks: [text("Done.")] }),
    ],
    {},
    {},
  );
});

async function census(
  root: string,
  args: string[],
): Promise<{ out: string; json: Record<string, unknown> }> {
  const jsonPath = join(root, "..", `census-${Math.random().toString(36).slice(2)}.json`);
  const { stdout } = await execFileAsync("node", [
    CENSUS,
    "--root",
    root,
    "--json",
    jsonPath,
    ...args,
  ]);
  return { out: stdout, json: JSON.parse(await readFile(jsonPath, "utf-8")) };
}

describe("census: walker full mode (via the CLI's counts)", () => {
  it("counts operator prompts, tool calls and agent results, excluding tool results and system-shaped text", async () => {
    const { json } = await census(seeded, ["--class", "all"]);
    expect(json.prompts).toBe(6); // s1: 4 operator prompts (the 2 tool results are not prompts); s2, s3: 1 each
    expect(json.tools).toBe(9); // t1..t9
    expect(json.agentResults).toBe(2);
  });
});
