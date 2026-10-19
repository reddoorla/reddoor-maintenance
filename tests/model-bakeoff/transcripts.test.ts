import { describe, it, expect } from "vitest";
import {
  forbiddenCommand,
  readAgentTranscript,
} from "../../scripts/model-bakeoff/lib/transcripts.mjs";
import {
  REFEREE,
  mergeAgents,
  nextRound,
  verifyRan,
  type Collected,
} from "../../scripts/model-bakeoff/bakeoff.mjs";

const user = (text: string) => JSON.stringify({ message: { role: "user", content: text } });
const assistant = (id: string, content: unknown[], effort = "low", model = "claude-haiku-5-5") =>
  JSON.stringify({
    effort,
    message: {
      id,
      model,
      role: "assistant",
      content,
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command } });
const output = (input: unknown, id = "so") => ({
  type: "tool_use",
  id,
  name: "StructuredOutput",
  input,
});

describe("readAgentTranscript", () => {
  const text = [
    user("do the census\n\n(BAKEOFF-ARM: haiku-low-1)"),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m2", [output({ scripts: [] })]),
  ].join("\n");

  it("reads the arm, what ran, and the structured output, counting each message once", () => {
    const t = readAgentTranscript(text);
    expect(t.marker).toEqual({ kind: "arm", id: "haiku-low-1" });
    expect(t.structured).toEqual({ scripts: [] });
    expect(t.models).toEqual(["claude-haiku-5-5"]);
    expect(t.efforts).toEqual(["low"]);
    expect(t.requests).toBe(2);
    expect(t.repeats).toBe(1);
    expect(t.forbidden).toEqual([]);
  });

  it("takes the last structured output the harness accepted, not one it rejected", () => {
    const rejected = JSON.stringify({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "late", is_error: true, content: "bad" }],
      },
    });
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant("m1", [output({ ok: 1 }, "early")]),
        assistant("m2", [output({ ok: 0 }, "late")]),
        rejected,
      ].join("\n"),
    );
    expect(t.structured).toEqual({ ok: 1 });
  });

  it("reads only the trailing marker, and refuses a prompt that quotes another", () => {
    expect(readAgentTranscript(user("task\n\n(BAKEOFF-REFEREE: r2-1)")).marker).toEqual({
      kind: "referee",
      id: "r2-1",
    });
    const quoting = readAgentTranscript(
      user('items: ["(BAKEOFF-ARM: gold)"]\n\n(BAKEOFF-REFEREE: r1-1)'),
    );
    expect(quoting.marker).toBeNull();
    expect(quoting.markerError).toMatch(/2 markers/);
    expect(readAgentTranscript(user("(BAKEOFF-ARM: a) and then more text")).marker).toBeNull();
  });

  it("records every file write and every MCP tool use", () => {
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant("m1", [
          { type: "tool_use", name: "Write", input: { file_path: "/w/a/x.py" } },
          { type: "tool_use", name: "Edit", input: { file_path: "/tmp/y.py" } },
          { type: "tool_use", name: "mcp__github__issue_write", input: {} },
        ]),
      ].join("\n"),
    );
    expect(t.writes).toEqual(["/w/a/x.py", "/tmp/y.py"]);
    expect(t.otherTools).toEqual(["mcp__github__issue_write"]);
  });
});

describe("forbiddenCommand", () => {
  it.each([
    "gh issue create -t x",
    "cd /x && git push origin main",
    "git -C /repo push origin x",
    "git -c user.name=x commit -m y",
    "git --no-pager push",
    "/usr/bin/gh api -X POST repos/x",
    '"gh" issue create',
    "$(which gh) api",
    "echo done; gh pr list",
    "GH_TOKEN=x gh api user",
    "curl -s -X POST https://api.github.com/x",
    "curl --request POST https://x",
    "curl -d a=1 https://x",
    "curl --data @f https://x",
    "git rm a.txt",
    "cd x\ngh api repos/a/b",
    "bash -c 'gh api x'",
    'sh -c "git push"',
    "eval 'git commit -m x'",
    "ls | xargs gh pr list",
    "time gh api x",
    "command gh api x",
    "git --git-dir /x commit -m y",
    "curl --json {} https://x",
    "curl -d@f https://x",
  ])("flags %s", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(true);
  });

  it.each([
    "grep -c 'gh api' /x/scripts/land-prs.mjs",
    "grep -rn 'git push' scripts",
    "grep -l gh *.mjs",
    "grep -c ' gh ' f",
    "wc -l /x/scripts/*",
    "git log --oneline -3",
    "git branch -a",
    "curl -s https://example.com",
  ])("lets the read %s through", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(false);
  });
});

describe("verifyRan", () => {
  const ran = readAgentTranscript(
    [user("(BAKEOFF-ARM: a)"), assistant("m", [output({})], "xhigh", "claude-opus-5-5")].join("\n"),
  );

  it("reports a model or an effort the transcripts contradict", () => {
    expect(verifyRan({ id: "a", model: "opus", effort: "xhigh" }, ran)).toEqual([]);
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, ran)).toEqual([
      "a: asked for claude-haiku-5-5, transcripts show claude-opus-5-5",
      "a: asked for effort low, transcripts show xhigh",
    ]);
  });

  it("reports a run with no accepted output, a write outside its own dir, and MCP use", () => {
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant(
          "m",
          [
            { type: "tool_use", name: "Write", input: { file_path: "/run/work/a/ok.py" } },
            { type: "tool_use", name: "Write", input: { file_path: "/run/work/ab/x.py" } },
            { type: "tool_use", name: "mcp__github__push_files", input: {} },
          ],
          "low",
        ),
      ].join("\n"),
    );
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, t, "/run/work/a")).toEqual([
      "a: no accepted structured output",
      "a: used tools outside the allowlist: mcp__github__push_files",
      "a: wrote outside /run/work/a: /run/work/ab/x.py",
    ]);
  });

  it("holds the referee to its own model and effort", () => {
    const ref = readAgentTranscript(
      [
        user("(BAKEOFF-REFEREE: r1-1)"),
        assistant("m", [output({ rulings: [] })], "xhigh", "claude-sonnet-5-5"),
      ].join("\n"),
    );
    expect(verifyRan(REFEREE, ref)).toEqual([
      "referee:r1-1: asked for claude-opus-5-5, transcripts show claude-sonnet-5-5",
      "referee:r1-1: asked for effort high, transcripts show xhigh",
    ]);
  });
});

describe("collecting several rounds", () => {
  const ARGS = {
    dir: "/r/input",
    work: "/r/work",
    gold: { id: "gold", model: "opus", effort: "high" },
    arms: [{ id: "a", model: "haiku", effort: "low" }],
  };
  const prompt = (dir: string, work: string, marker: string) =>
    `Census of ${dir}.\nYour own scratch directory is ${work}. Create it.\n\n(${marker})`;
  const referee = (id: string, transcript: string, ruling: string, dir = ARGS.dir) =>
    ({
      ...readAgentTranscript(
        [
          user(prompt(dir, `/r/work/referee-${id}`, `BAKEOFF-REFEREE: ${id}`)),
          assistant("m", [output({ rulings: [{ id: ruling }] })], "high", "claude-opus-5-5"),
        ].join("\n"),
      ),
      transcript,
    }) as Collected;
  const arm = (id: string, transcript: string, dir = ARGS.dir) =>
    ({
      ...readAgentTranscript(
        [
          user(prompt(dir, `/r/work/${id}`, `BAKEOFF-ARM: ${id}`)),
          assistant("m", [output({})]),
        ].join("\n"),
      ),
      transcript,
    }) as Collected;

  it("keeps round 1's rulings when round 2 arrives, and numbers the next round", () => {
    const first = mergeAgents({}, [referee("r1-1", "/t/wf1/agent-z.jsonl", "A")], ARGS);
    expect(first.errors).toEqual([]);
    expect(nextRound(first.agents)).toBe(2);
    const second = mergeAgents(first.agents, [referee("r2-1", "/t/wf2/agent-a.jsonl", "B")], ARGS);
    expect(second.errors).toEqual([]);
    expect(Object.keys(second.agents).sort()).toEqual(["referee:r1-1", "referee:r2-1"]);
    expect(nextRound(second.agents)).toBe(3);
  });

  it("refuses two transcripts that claim the same marker", () => {
    const { errors } = mergeAgents(
      {},
      [referee("r1-1", "/t/wf1/agent-z.jsonl", "A"), referee("r1-1", "/t/wf2/agent-a.jsonl", "B")],
      ARGS,
    );
    expect(errors).toEqual([
      "referee:r1-1 has two transcripts: /t/wf1/agent-z.jsonl and /t/wf2/agent-a.jsonl",
    ]);
  });

  it("accepts the same transcript collected twice", () => {
    const one = referee("r1-1", "/t/wf1/agent-z.jsonl", "A");
    const first = mergeAgents({}, [one], ARGS);
    expect(mergeAgents(first.agents, [one], ARGS).errors).toEqual([]);
  });

  it("refuses a transcript from another run, and a marker that names no arm", () => {
    const { agents, errors } = mergeAgents(
      {},
      [
        arm("a", "/t/old/agent-1.jsonl", "/other/input"),
        arm("stranger", "/t/wf/agent-2.jsonl"),
        arm("a", "/t/wf/agent-3.jsonl"),
      ],
      ARGS,
    );
    expect(errors).toEqual([
      "/t/old/agent-1.jsonl: a's prompt does not name this run's input /r/input and work dir /r/work/a",
      "/t/wf/agent-2.jsonl: marker stranger names no arm of this run",
    ]);
    expect(Object.keys(agents)).toEqual(["a"]);
  });
});

describe("a referee chunk that returned nothing", () => {
  it("stops counting once no disagreement is left unruled", () => {
    const empty = readAgentTranscript(
      [user("(BAKEOFF-REFEREE: r1-1)"), assistant("m", [], "high", "claude-opus-5-5")].join("\n"),
    );
    expect(verifyRan(REFEREE, empty)).toEqual(["referee:r1-1: no accepted structured output"]);
    expect(verifyRan(REFEREE, empty, undefined, { needOutput: false })).toEqual([]);
  });
});

describe("verifyRan's write check", () => {
  it("resolves .. and treats a relative path as outside", () => {
    const t = {
      ...readAgentTranscript(
        [user("(BAKEOFF-ARM: a)"), assistant("m", [output({})], "low")].join("\n"),
      ),
      writes: ["/r/work/a/../b/census.py", "census.py", "/r/work/a/sub/ok.py"],
    };
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, t, "/r/work/a")).toEqual([
      "a: wrote outside /r/work/a: /r/work/a/../b/census.py, census.py",
    ]);
  });
});
