import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CENSUS = fileURLToPath(new URL("../../scripts/meta-week/census.mjs", import.meta.url));
const WINDOW = fileURLToPath(
  new URL("../../scripts/meta-week/transcript-window.mjs", import.meta.url),
);

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
  status?: string;
  sessionId?: string;
  repo?: string;
}): string {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: o.sessionId ?? "s1",
    isSidechain: false,
    cwd: CWD(o.repo ?? "alpha"),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: o.toolUseId, content: "done" }],
    },
    toolUseResult: {
      agentId: o.agentId,
      status: o.status ?? "completed",
      totalTokens: o.totalTokens,
    },
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

/**
 * The record an account-limit kill leaves as the LAST line of a subagent transcript: the
 * limit answers instead of the model, so stop_reason is "stop_sequence", the usage is all
 * zero, and the record carries quotaLimits.status "rejected". Copied from the real shape
 * in agent-ae3ffd42915dedb3b.jsonl (2026-08-24).
 */
function quotaRejected(o: {
  ts: string;
  agentId: string;
  sessionId: string;
  repo: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    uuid: uid("a"),
    requestId: "",
    timestamp: o.ts,
    sessionId: o.sessionId,
    isSidechain: true,
    agentId: o.agentId,
    attributionAgent: "general-purpose",
    cwd: CWD(o.repo),
    quotaLimits: {
      status: "rejected",
      resetsAt: 1787605200,
      rateLimitType: "five_hour",
      overageStatus: "rejected",
    },
    message: {
      role: "assistant",
      model: "claude-fable-5",
      stop_reason: "stop_sequence",
      content: [
        { type: "text", text: "You've hit your session limit · resets 2pm (America/Los_Angeles)" },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

/** The other kill shape: a tool_result the agent never answered. */
function interruptedTail(o: { ts: string; agentId: string; sessionId: string; repo: string }) {
  return JSON.stringify({
    type: "user",
    uuid: uid("u"),
    timestamp: o.ts,
    sessionId: o.sessionId,
    isSidechain: true,
    agentId: o.agentId,
    cwd: CWD(o.repo),
    message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
  });
}

/** The parent's completion notice for an async dispatch. */
function taskNotification(o: {
  ts: string;
  agentId: string;
  status: string;
  sessionId: string;
  repo: string;
}): string {
  return user({
    ts: o.ts,
    sessionId: o.sessionId,
    repo: o.repo,
    text:
      `<task-notification>\n<task-id>${o.agentId}</task-id>\n` +
      `<status>${o.status}</status>\n<summary>agent finished</summary>\n</task-notification>`,
  });
}

const T = (hms: string) => `2026-09-02T${hms}Z`;
const T3 = (hms: string) => `2026-09-03T${hms}Z`;
const T4 = (hms: string) => `2026-09-04T${hms}Z`;

let seeded: string;
let clean: string;
let shaped: string;
let lagged: string;
let triple: string;
let orphans: string;
let gitRoot: string;
let emptyRoot: string;

async function writeRoot(
  dir: string,
  s1Lines: string[],
  extra: Record<string, string[]>,
  subagents: Record<string, string[]>,
  metas: Record<string, Record<string, unknown>> = {},
  // The transcript file and the subagents directory are both NAMED for the session, which
  // is what `--session` prefilters on. Default "s1" for the roots whose records say "s1";
  // a root whose records carry another id must pass it, or the layout is not the real one.
  sessionDir = "s1",
) {
  const alpha = join(dir, "-Users-x-Documents-GitHub-alpha");
  await mkdir(join(alpha, sessionDir, "subagents"), { recursive: true });
  await writeFile(join(alpha, `${sessionDir}.jsonl`), s1Lines.join("\n") + "\n");
  for (const [name, lines] of Object.entries(subagents)) {
    await writeFile(
      join(alpha, sessionDir, "subagents", `agent-${name}.jsonl`),
      lines.join("\n") + "\n",
    );
  }
  for (const [name, meta] of Object.entries(metas)) {
    await writeFile(
      join(alpha, sessionDir, "subagents", `agent-${name}.meta.json`),
      JSON.stringify(meta),
    );
  }
  for (const [repo, lines] of Object.entries(extra)) {
    const d = join(dir, `-Users-x-Documents-GitHub-${repo}`);
    await mkdir(d, { recursive: true });
    await writeFile(join(d, `s-${repo}.jsonl`), lines.join("\n") + "\n");
  }
}

/**
 * A two-directory git fixture for the `--git` pass: one real repo and one LINKED WORKTREE
 * of it. The worktree marks its `.git` as a FILE, not a directory, which is the only thing
 * that distinguishes it from a repo of its own from the outside — and `git log --all` in
 * it sees the same ref store, so counting it counts every commit twice.
 *
 * The repo carries three commits: one whose subject begins "Revert", one that merely
 * mentions reverting, and one whose SUBJECT does not but whose BODY has a line starting
 * with "revert" — the last exists because `git log --grep='^[Rr]evert'` anchors per LINE,
 * not to the subject (probed, 2026-09-14), so the grep alone still matches it.
 */
async function buildGitFixture(dir: string) {
  const repo = join(dir, "solo");
  await mkdir(repo, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-09-01T12:00:00Z",
    GIT_COMMITTER_DATE: "2026-09-01T12:00:00Z",
  };
  const git = (args: string[]) =>
    execFileAsync(
      "git",
      [
        "-C",
        repo,
        "-c",
        "user.email=t@e",
        "-c",
        "user.name=T",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { env },
    );
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  const commit = async (name: string, message: string) => {
    await writeFile(join(repo, name), name);
    await git(["add", name]);
    await git(["commit", "-q", "-m", message]);
  };
  await commit("a.txt", 'Revert "feat: the thing"');
  await commit("b.txt", "fix: this mentions revert of a thing");
  await commit("c.txt", "chore: subject\n\nrevert the probe field in the body");
  await git(["worktree", "add", "-q", "-b", "wt", join(dir, "solo-wt")]);
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "census-"));
  seeded = join(base, "seeded");
  clean = join(base, "clean");
  shaped = join(base, "shaped");
  lagged = join(base, "lagged");
  triple = join(base, "triple");
  orphans = join(base, "orphans");
  gitRoot = join(base, "gitfix");
  emptyRoot = join(base, "no-transcripts");
  await mkdir(emptyRoot, { recursive: true });
  await buildGitFixture(gitRoot);

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

  // SHAPED: the four record shapes the IDE and the harness write as `type: "user"`.
  // Every line is a real shape from the corpus (probe, 2026-09-14). The two are NOT the
  // same defect: an IDE preamble always wraps a real operator turn (133 of 133 in the
  // corpus carried one, 0 were preamble-only), so it is STRIPPED and the turn kept; the
  // harness's summarisation request and its compaction continuation carry no operator
  // turn at all, and are dropped whole. Session "s9", repo delta, 2026-09-03:
  //   09:00 USER  <ide_opened_file> preamble + "stop, kill them"   <- a real stop
  //   09:01 subagent g9 usage (out 30)                             <- its cost
  //   09:20 USER  <ide_selection> preamble, nothing after it       <- dropped: no turn
  //   09:30 USER  the harness's summarisation request, quoting a transcript that
  //               contains "stop and ask the user" — how it matched STOP_RE for real
  //   09:31 ASSISTANT out 20
  //   09:40 USER  the harness's compaction continuation, whose summary quotes
  //               "are you sure" — a CORRECTION_RE phrase the operator never typed here
  await writeRoot(
    shaped,
    [
      user({
        ts: T3("09:00:00"),
        sessionId: "s9",
        repo: "delta",
        text:
          "<ide_opened_file>The user opened the file /p/notes.md in the IDE. This may or may not be related to the current task.</ide_opened_file>\n" +
          "stop, kill them",
      }),
      user({
        ts: T3("09:20:00"),
        sessionId: "s9",
        repo: "delta",
        text: "<ide_selection>The user selected the lines 1 to 2 from /p/notes.md:\n[[a note]]\n\nThis may or may not be related to the current task.</ide_selection>",
      }),
      user({
        ts: T3("09:30:00"),
        sessionId: "s9",
        repo: "delta",
        text:
          "Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant.\n\n" +
          "Please write a concise, factual summary of this conversation.\n\n" +
          'Agent: the plan has six separate "stop and ask the user to compile" points.',
      }),
      assistant({
        ts: T3("09:31:00"),
        sessionId: "s9",
        repo: "delta",
        requestId: "d1",
        out: 20,
        blocks: [text("working")],
      }),
      user({
        ts: T3("09:40:00"),
        sessionId: "s9",
        repo: "delta",
        text:
          "This session is being continued from a previous conversation that ran out of context. " +
          "The summary below covers the earlier portion of the conversation.\n\n" +
          "Summary: the operator asked, are you sure the gate ran?",
      }),
    ],
    {},
    {
      g9: [
        assistant({
          ts: T3("09:01:00"),
          sessionId: "s9",
          repo: "delta",
          requestId: "ds1",
          out: 30,
          blocks: [text("still going")],
          sidechain: true,
          agentId: "g9",
        }),
      ],
    },
  );

  // LAGGED: the real shape of a resume after a limit block. The operator waits for the
  // five-hour session window to reset, so the lag is hours, not minutes (corpus, n = 237:
  // min 57 min, median 212, max 1,312). Session "s10" hits the wall twice — one block at
  // 11:00 and a retry at 13:00 — and resumes at 16:00; that is ONE episode and must be
  // nominated once, from the nearest block. Session "s11" resumes at seven hours, past
  // the six-hour bound, and must not be nominated at all — the widening has to stay
  // bounded or it pairs a block with any later "continue" the session ever contains.
  await writeRoot(
    lagged,
    [
      assistant({
        ts: T3("11:00:00"),
        sessionId: "s10",
        repo: "epsilon",
        requestId: "lb1",
        out: 0,
        blocks: [text("You've hit your session limit · resets 4pm (America/Los_Angeles)")],
      }),
      assistant({
        ts: T3("13:00:00"),
        sessionId: "s10",
        repo: "epsilon",
        requestId: "lb1b",
        out: 0,
        blocks: [text("You've hit your session limit · resets 4pm (America/Los_Angeles)")],
      }),
      user({
        ts: T3("16:00:00"),
        sessionId: "s10",
        repo: "epsilon",
        text: "hit a session limit, continue where you left off",
      }),
      assistant({
        ts: T3("16:05:00"),
        sessionId: "s10",
        repo: "epsilon",
        requestId: "lr1",
        out: 12,
        blocks: [text("picking it back up")],
      }),
    ],
    {
      zeta: [
        assistant({
          ts: T3("11:00:00"),
          sessionId: "s11",
          repo: "zeta",
          requestId: "lb2",
          out: 0,
          blocks: [text("You've hit your session limit · resets 4pm (America/Los_Angeles)")],
        }),
        user({
          ts: T3("18:00:00"),
          sessionId: "s11",
          repo: "zeta",
          text: "new morning, continue with the next item",
        }),
        assistant({
          ts: T3("18:05:00"),
          sessionId: "s11",
          repo: "zeta",
          requestId: "lr2",
          out: 99,
          blocks: [text("on it")],
        }),
      ],
    },
    {},
  );

  // TRIPLE: three near-identical Agent dispatches in one session. There are three PAIRS
  // but only two repeats — the episode is the later dispatch, and pairing it with each
  // earlier one it resembles counts the same dispatch twice. Jaccard, by hand:
  // (1,2) 5/6 = 0.83, (1,3) 5/7 = 0.71, (2,3) 6/7 = 0.86 — so dispatch 3's best earlier
  // match is dispatch 2, and it cleared the bar against both.
  await writeRoot(
    triple,
    [
      assistant({
        ts: T3("10:00:00"),
        sessionId: "s12",
        repo: "eta",
        requestId: "p1",
        out: 5,
        blocks: [agent("t20", "audit the forms module for X")],
      }),
      toolResult({
        ts: T3("10:01:00"),
        sessionId: "s12",
        repo: "eta",
        toolUseId: "t20",
        agentId: "h1",
        totalTokens: 1000,
      }),
      assistant({
        ts: T3("10:10:00"),
        sessionId: "s12",
        repo: "eta",
        requestId: "p2",
        out: 5,
        blocks: [agent("t21", "audit the forms module for X please")],
      }),
      toolResult({
        ts: T3("10:11:00"),
        sessionId: "s12",
        repo: "eta",
        toolUseId: "t21",
        agentId: "h2",
        totalTokens: 2000,
      }),
      assistant({
        ts: T3("10:20:00"),
        sessionId: "s12",
        repo: "eta",
        requestId: "p3",
        out: 5,
        blocks: [agent("t22", "audit the forms module for X again please")],
      }),
      toolResult({
        ts: T3("10:21:00"),
        sessionId: "s12",
        repo: "eta",
        toolUseId: "t22",
        agentId: "h3",
        totalTokens: 3000,
      }),
    ],
    {},
    {},
  );
  // ORPHANS: subagents that were DISPATCHED AND NEVER RETURNED, and the three shapes that
  // look like one and are not. Session "s13", repo theta, 2026-09-04 — modelled on the
  // three #569 review lenses killed by the wall at 2026-08-24T20:14Z and re-sent at 21:33Z.
  //   10:00 ASSISTANT Agent(t30) "Review the fleet table"        -> agent o1
  //   10:00:05 USER tool_result status "async_launched" (written AT LAUNCH, not at return)
  //     o1: two requests, one of them written TWICE under the same requestId (out 50 then
  //         900 — the meter keeps the larger), then a quotaLimits "rejected" tail.
  //   11:00 ASSISTANT Agent(t31) with the SAME description               -> agent o2, ok
  //   11:30 USER <task-notification> o2 completed
  //   12:00 ASSISTANT Agent(t32) "Guarded lens"                          -> agent o3
  //     o3 ends on "[Request interrupted by user]" but its parent reported it COMPLETED,
  //     so it returned and is not an orphan — the guard, exercised.
  //   13:00 ASSISTANT Agent(t33) "Still running"                         -> agent o4
  //     o4's file stops mid tool_use: that is what a LIVE agent looks like, not a kill.
  //   14:00 ASSISTANT Agent(t34) "Unrepeated lens"                       -> agent o5
  //     o5 was interrupted and never re-sent: an orphan with redispatched null.
  await writeRoot(
    orphans,
    [
      assistant({
        ts: T4("10:00:00"),
        sessionId: "s13",
        repo: "theta",
        requestId: "r40",
        out: 5,
        blocks: [agent("t30", "look at the fleet table")],
      }),
      toolResult({
        ts: T4("10:00:05"),
        sessionId: "s13",
        repo: "theta",
        toolUseId: "t30",
        agentId: "o1",
        status: "async_launched",
        totalTokens: 0,
      }),
      assistant({
        ts: T4("11:00:00"),
        sessionId: "s13",
        repo: "theta",
        requestId: "r41",
        out: 5,
        blocks: [agent("t31", "look at the fleet table")],
      }),
      toolResult({
        ts: T4("11:00:05"),
        sessionId: "s13",
        repo: "theta",
        toolUseId: "t31",
        agentId: "o2",
        status: "async_launched",
        totalTokens: 0,
      }),
      taskNotification({
        ts: T4("11:30:00"),
        sessionId: "s13",
        repo: "theta",
        agentId: "o2",
        status: "completed",
      }),
      assistant({
        ts: T4("12:00:00"),
        sessionId: "s13",
        repo: "theta",
        requestId: "r42",
        out: 5,
        blocks: [agent("t32", "the guarded lens")],
      }),
      taskNotification({
        ts: T4("12:30:00"),
        sessionId: "s13",
        repo: "theta",
        agentId: "o3",
        status: "completed",
      }),
      assistant({
        ts: T4("13:00:00"),
        sessionId: "s13",
        repo: "theta",
        requestId: "r43",
        out: 5,
        blocks: [agent("t33", "the one still running")],
      }),
      assistant({
        ts: T4("14:00:00"),
        sessionId: "s13",
        repo: "theta",
        requestId: "r44",
        out: 5,
        blocks: [agent("t34", "the unrepeated lens")],
      }),
    ],
    {},
    {
      o1: [
        assistant({
          ts: T4("10:00:10"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o1a",
          out: 100,
          blocks: [text("reading")],
          sidechain: true,
          agentId: "o1",
        }),
        assistant({
          ts: T4("10:01:00"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o1b",
          out: 50,
          blocks: [text("partial block")],
          sidechain: true,
          agentId: "o1",
        }),
        assistant({
          ts: T4("10:01:01"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o1b",
          out: 900,
          blocks: [text("partial block, finished")],
          sidechain: true,
          agentId: "o1",
        }),
        quotaRejected({ ts: T4("10:02:00"), sessionId: "s13", repo: "theta", agentId: "o1" }),
      ],
      o2: [
        assistant({
          ts: T4("11:00:10"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o2a",
          out: 70,
          blocks: [text("lens report")],
          sidechain: true,
          agentId: "o2",
        }),
      ],
      o3: [
        assistant({
          ts: T4("12:00:10"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o3a",
          out: 60,
          blocks: [text("halfway")],
          sidechain: true,
          agentId: "o3",
        }),
        interruptedTail({ ts: T4("12:01:00"), sessionId: "s13", repo: "theta", agentId: "o3" }),
      ],
      o4: [
        assistant({
          ts: T4("13:00:10"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o4a",
          out: 40,
          blocks: [read("t98", "/p/z.ts")],
          sidechain: true,
          agentId: "o4",
        }),
      ],
      o5: [
        assistant({
          ts: T4("14:00:10"),
          sessionId: "s13",
          repo: "theta",
          requestId: "o5a",
          out: 33,
          blocks: [text("started")],
          sidechain: true,
          agentId: "o5",
        }),
        interruptedTail({ ts: T4("14:01:00"), sessionId: "s13", repo: "theta", agentId: "o5" }),
      ],
    },
    {
      o1: {
        agentType: "general-purpose",
        description: "Review the fleet table",
        toolUseId: "t30",
        spawnDepth: 1,
      },
      o2: {
        agentType: "general-purpose",
        description: "Review the fleet table",
        toolUseId: "t31",
        spawnDepth: 1,
      },
      o3: {
        agentType: "general-purpose",
        description: "Guarded lens",
        toolUseId: "t32",
        spawnDepth: 1,
      },
      o4: {
        agentType: "general-purpose",
        description: "Still running",
        toolUseId: "t33",
        spawnDepth: 1,
      },
      o5: {
        agentType: "general-purpose",
        description: "Unrepeated lens",
        toolUseId: "t34",
        spawnDepth: 1,
      },
    },
    "s13",
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

type Cand = {
  class: string;
  kind: string;
  sessionId: string;
  repo: string;
  ts: string;
  cost: { requests: number; out: number; agentTotal?: number };
  evidence: Record<string, unknown>;
};
function kinds(json: Record<string, unknown>, cls: string): Cand[] {
  return ((json.classes as Record<string, { candidates: Cand[] }>)[cls]?.candidates ??
    []) as Cand[];
}

describe("census: walker full mode (via the CLI's counts)", () => {
  it("counts operator prompts, tool calls and agent results, excluding tool results and system-shaped text", async () => {
    const { json } = await census(seeded, ["--class", "all"]);
    expect(json.prompts).toBe(6); // s1: 4 operator prompts (the 2 tool results are not prompts); s2, s3: 1 each
    expect(json.tools).toBe(9); // t1..t9
    expect(json.agentResults).toBe(2);
  });
});

describe("census: system-generated records are not operator prompts", () => {
  it("PASS: drops the harness's own records, keeps the operator turn an IDE preamble wraps", async () => {
    const { json } = await census(shaped, ["--class", "all"]);
    // Only the IDE-wrapped turn is an operator prompt; the other three lines are not.
    expect(json.prompts).toBe(1);
    const f = kinds(json, "fanout");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "spend-after-stop", sessionId: "s9", repo: "delta" });
    // The preamble is stripped, so the evidence is the turn the operator actually typed.
    expect(f[0]!.evidence.prompt).toBe("stop, kill them");
    expect(f[0]!.cost.out).toBe(30);
    // The summarisation request's quoted "stop and ask" and the continuation's quoted
    // "are you sure" nominate nothing, because neither record is a prompt.
    expect(kinds(json, "unread")).toEqual([]);
    expect(kinds(json, "redo")).toEqual([]);
  });
});

describe("census: fan-out", () => {
  it("PASS: finds spend after a stop request, continue after a block, and one turn across three sessions", async () => {
    const { json } = await census(seeded, ["--class", "fanout"]);
    const c = kinds(json, "fanout");
    const stop = c.find((x) => x.kind === "spend-after-stop");
    expect(stop).toMatchObject({ sessionId: "s1", repo: "alpha" });
    expect(stop?.cost.out).toBe(25);
    const cont = c.find((x) => x.kind === "continue-after-block");
    expect(cont).toMatchObject({ sessionId: "s1" });
    expect(cont?.evidence.lagMin).toBe(3);
    expect(cont?.cost.out).toBe(12);
    const same = c.find((x) => x.kind === "same-turn-many-sessions");
    expect(same?.evidence.sessions).toBe(3);
    expect(same?.evidence.repos).toEqual(["alpha", "beta", "gamma"]);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "fanout"]);
    expect(kinds(json, "fanout")).toEqual([]);
  });

  it("nominates a resume five hours after a block, once per resume, and not one seven hours after", async () => {
    const { json } = await census(lagged, ["--class", "fanout"]);
    const c = kinds(json, "fanout").filter((x) => x.kind === "continue-after-block");
    expect(c).toHaveLength(1); // two blocks, one resume: one candidate, not two
    expect(c[0]).toMatchObject({ sessionId: "s10", repo: "epsilon" });
    expect(c[0]!.evidence.blocks).toBe(2);
    expect(c[0]!.evidence.lagMin).toBe(180); // from the NEAREST block (13:00), not the first
    expect(c[0]!.cost.out).toBe(12); // the 30 minutes after the continue, not the 7-hour session
  });
});

describe("census: redo", () => {
  it("PASS: finds files re-read after a compaction and a near-duplicate Agent prompt", async () => {
    const { json } = await census(seeded, ["--class", "redo"]);
    const c = kinds(json, "redo");
    const reread = c.find((x) => x.kind === "reread-after-compaction");
    expect(reread?.evidence.filesReReadCount).toBe(3);
    expect(reread?.cost.out).toBe(57); // the main lane's hour after 10:20: r4 30 + r5 15 + rb 0 + r6 12
    const dup = c.find((x) => x.kind === "duplicate-agent-prompt");
    expect(dup?.evidence.similarity as number).toBeGreaterThanOrEqual(0.7);
    expect(dup?.cost.agentTotal).toBe(7000);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "redo"]);
    expect(kinds(json, "redo")).toEqual([]);
  });

  it("counts a repeated dispatch once, against its closest earlier prompt", async () => {
    const { json } = await census(triple, ["--class", "redo"]);
    const c = kinds(json, "redo").filter((x) => x.kind === "duplicate-agent-prompt");
    expect(c).toHaveLength(2); // three near-identical dispatches are two repeats, not three pairs
    const second = c.find((x) => x.cost.agentTotal === 2000);
    expect(second?.evidence.matches).toBe(1);
    expect(second?.evidence.similarity).toBe(0.83);
    const third = c.find((x) => x.cost.agentTotal === 3000);
    expect(third?.evidence.matches).toBe(2); // cleared the bar against both earlier prompts
    expect(third?.evidence.similarity).toBe(0.86); // paired with the closest, not the first
    expect(third?.evidence.first).toBe("audit the forms module for X please");
  });
});

describe("census: orphaned agents", () => {
  it("PASS: nominates the killed dispatches, prices each from its own deduped usage, and resolves the re-dispatch", async () => {
    const { json } = await census(orphans, ["--class", "fanout"]);
    const c = kinds(json, "fanout").filter((x) => x.kind === "orphaned-agent");
    expect(c.map((x) => x.evidence.agentId).sort()).toEqual(["o1", "o5"]);

    const killed = c.filter((x) => x.evidence.lastStatus === "quota-rejected");
    expect(killed).toHaveLength(1);
    expect(killed[0]).toMatchObject({ sessionId: "s13", repo: "theta" });
    expect(killed[0]!.evidence.description).toBe("Review the fleet table");
    expect(killed[0]!.evidence.toolUseId).toBe("t30");
    expect(killed[0]!.evidence.agentType).toBe("general-purpose");
    // Two requests, not three: o1b was written twice and the meter keeps the larger.
    expect(killed[0]!.cost.requests).toBe(2);
    expect(killed[0]!.cost.out).toBe(1000);
    expect(killed[0]!.cost.agentTotal).toBe(1002); // out 1,000 + the two kept records' in
    // The re-dispatch is the later Agent call whose DESCRIPTION is byte-identical.
    expect(killed[0]!.evidence.redispatched).toBe("t31");

    const lone = c.find((x) => x.evidence.agentId === "o5");
    expect(lone?.evidence.lastStatus).toBe("interrupted");
    expect(lone?.evidence.redispatched).toBeNull(); // never re-sent
    expect(lone?.cost.out).toBe(33);
  });

  it("does not nominate an agent that returned, one the parent reported completed, or one still in flight", async () => {
    const { json } = await census(orphans, ["--class", "fanout"]);
    const ids = kinds(json, "fanout")
      .filter((x) => x.kind === "orphaned-agent")
      .map((x) => x.evidence.agentId);
    expect(ids).not.toContain("o2"); // ended on a finished turn
    expect(ids).not.toContain("o3"); // ends "[Request interrupted…]" but was reported completed
    expect(ids).not.toContain("o4"); // stops mid tool_use — indistinguishable from in flight
    // The walker still sees all five agents; the finder is what rejects three of them.
    expect(json.agents).toBe(5);
    expect(json.notifications).toBe(2);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "fanout"]);
    expect(kinds(json, "fanout").filter((x) => x.kind === "orphaned-agent")).toEqual([]);
  });
});

/**
 * The three flags the SessionStart hook needs. `--session` is the one with a mechanism
 * worth testing: it PREFILTERS the walk by path — the corpus is 2.7 GB and reading all of
 * it takes ~15 s, far too slow for a hook — and then filters candidates on the records'
 * own sessionId. The two must agree, so the fixture's directory is named for the session
 * exactly as Claude Code names it.
 */
describe("census: session scoping and machine-readable output", () => {
  it("PASS: --session reads only that session's files and finds the same orphans as the unscoped run", async () => {
    const unscoped = await census(orphans, ["--class", "fanout"]);
    const scoped = await census(orphans, ["--class", "fanout", "--session", "s13"]);
    expect(scoped.json.session).toBe("s13");
    // s13.jsonl + the five subagent transcripts, and nothing else in the root.
    expect(scoped.json.files).toBe(6);
    expect(kinds(scoped.json, "fanout")).toEqual(kinds(unscoped.json, "fanout"));
  });

  it("FAIL control: a session with no files of its own yields no candidates", async () => {
    const { json } = await census(orphans, ["--class", "fanout", "--session", "s-absent"]);
    expect(json.files).toBe(0);
    expect(kinds(json, "fanout")).toEqual([]);
  });

  it("--kind keeps one kind and drops the rest of the class", async () => {
    const all = await census(seeded, ["--class", "fanout"]);
    expect(new Set(kinds(all.json, "fanout").map((c) => c.kind)).size).toBeGreaterThan(1);
    const { json } = await census(seeded, ["--class", "fanout", "--kind", "continue-after-block"]);
    expect(kinds(json, "fanout").map((c) => c.kind)).toEqual(["continue-after-block"]);
  });

  it("--json - writes the result object to stdout and prints nothing else", async () => {
    const { stdout } = await execFileAsync("node", [
      CENSUS,
      "--root",
      orphans,
      "--class",
      "fanout",
      "--kind",
      "orphaned-agent",
      "--session",
      "s13",
      "--json",
      "-",
    ]);
    // The whole of stdout parses: no table, no counts line, no trailing noise.
    const json = JSON.parse(stdout) as Record<string, unknown>;
    expect(json.session).toBe("s13");
    expect(json.kind).toBe("orphaned-agent");
    expect(
      kinds(json, "fanout")
        .map((c) => c.evidence.agentId)
        .sort(),
    ).toEqual(["o1", "o5"]);
  });

  it("records WHEN the re-dispatch went out, not only its id", async () => {
    const { json } = await census(orphans, ["--class", "fanout", "--kind", "orphaned-agent"]);
    const killed = kinds(json, "fanout").find((c) => c.evidence.agentId === "o1");
    expect(killed?.evidence.redispatched).toBe("t31");
    // The re-dispatched AGENT's first record (11:00:10), not the parent's Agent call
    // (11:00:00) — spawnedAt comes from the subagent transcript, which starts moments later.
    expect(killed?.evidence.redispatchedAt).toBe(T4("11:00:10"));
    const lone = kinds(json, "fanout").find((c) => c.evidence.agentId === "o5");
    expect(lone?.evidence.redispatchedAt).toBeNull();
  });
});

describe("census: unread mechanism", () => {
  it("PASS: costs the turn that a correction prompt corrects, from the previous prompt to the correction", async () => {
    const { json } = await census(seeded, ["--class", "unread"]);
    const c = kinds(json, "unread");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "corrected-turn", sessionId: "s1" });
    expect(c[0]!.cost.out).toBe(40); // r5 (15) in the main lane + the g3 subagent (25), both inside (10:30, 10:40]
    expect(c[0]!.evidence.minutes).toBe(10);
  });

  it("FAIL control: nominates nothing on the clean fixture", async () => {
    const { json } = await census(clean, ["--class", "unread"]);
    expect(kinds(json, "unread")).toEqual([]);
  });
});

describe("census: reverts (--git)", () => {
  it("counts subjects that begin with Revert, once per repo, skipping linked worktrees", async () => {
    const { out, json } = await census(emptyRoot, [
      "--class",
      "fanout",
      "--git",
      gitRoot,
      "--since",
      "2026-08-16",
    ]);
    const reverts = json.reverts as {
      count: number;
      byRepo: Record<string, number>;
      items: { repo: string; subject: string }[];
      skippedWorktrees: string[];
    };
    // Three commits mention reverting; one IS a revert. The worktree is not a repo.
    expect(reverts.count).toBe(1);
    expect(reverts.byRepo).toEqual({ solo: 1 });
    expect(reverts.items[0]!.subject).toBe('Revert "feat: the thing"');
    expect(reverts.skippedWorktrees).toEqual(["solo-wt"]);
    expect(out).toMatch(/subjects beginning with Revert/);
  });
});

describe("transcript-window", () => {
  it("prints the session's prompts, assistant text, tool calls and subagent activity inside the window, in order", async () => {
    const { stdout } = await execFileAsync("node", [
      WINDOW,
      "--root",
      seeded,
      "--session",
      "s1",
      "--from",
      T("10:29:00"),
      "--to",
      T("10:41:00"),
    ]);
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^10:30:00 USER stop, kill them/);
    expect(lines[1]).toMatch(/^10:31:00 \[agent general-purpose g3\] out=25/);
    expect(lines[2]).toMatch(/^10:35:00 ASSISTANT It is fixed\./);
    expect(lines[3]).toMatch(/^10:40:00 USER that's wrong/);
    expect(lines).toHaveLength(4);
  });

  it("prints tool calls as one-liners", async () => {
    const { stdout } = await execFileAsync("node", [
      WINDOW,
      "--root",
      seeded,
      "--session",
      "s1",
      "--from",
      T("09:59:00"),
      "--to",
      T("10:01:00"),
    ]);
    expect(stdout).toMatch(/^10:00:05 \[Read\] \/p\/a\.ts$/m);
    expect(stdout).toMatch(/^10:00:05 \[Edit\] \/p\/a\.ts$/m);
  });
});
