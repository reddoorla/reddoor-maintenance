import { afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { body, frontmatter, toolList } from "../_helpers/agent-frontmatter.js";
import { runWorkflow, type AgentCall } from "../_helpers/bakeoff-workflow.js";
import { AGENT_TYPE } from "../../scripts/model-bakeoff/lib/arms.mjs";
import {
  REFEREE,
  collectFile,
  extractArgs,
  runsPath,
  verifyRan,
} from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";
import * as refute from "../../scripts/model-bakeoff/tasks/refute-repo.mjs";

// Operator decisions 133 (c), answered (a): every bake-off agent (arm, gold and referee) runs
// as the `bakeoff-readonly` agent type, whose `tools` allowlist keeps Bash and drops every MCP,
// web and agent tool. A workflow agent() with no `agentType` runs as the default agent, which
// has them all; the one read-only rule a real run broke was an MCP call (refute-repo,
// 2026-10-19). The type cannot deny gh, git push or curl inside Bash: the 2026-10-20 probe
// showed that a `disallowedTools` entry with a specifier, such as `Bash(gh *)`, removes the
// whole Bash tool (an arm of the type reported no Bash tool, and a probe agent of it was
// answered "No such tool available: Bash"), and every task needs Bash. So nothing blocks a Bash
// command during the run; `forbiddenCommand` reads them afterwards, and a flagged one faults
// the arm in `score`. `score` also faults an agent whose .meta.json names another type.
const TYPE = "bakeoff-readonly";
const AGENT = fileURLToPath(new URL(`../../.claude/agents/${TYPE}.md`, import.meta.url));

describe(".claude/agents/bakeoff-readonly.md", () => {
  const text = readFileSync(AGENT, "utf8");
  const fm = frontmatter(text);

  it("is the agent type the workflow launches", () => {
    expect(fm.name).toBe(TYPE);
    expect(AGENT_TYPE).toBe(TYPE);
  });

  it("sets no disallowedTools, because a Bash entry there removes Bash itself", () => {
    expect(fm).not.toHaveProperty("disallowedTools");
  });

  it("keeps Bash, which pnpm-update, t4 and every gold and referee use, and no MCP, web or agent tool", () => {
    expect(toolList(fm.tools).sort()).toEqual(["Bash", "Edit", "Glob", "Grep", "Read", "Write"]);
  });

  it("leaves model and effort to each launch, and sets no key that could widen its permissions", () => {
    expect(Object.keys(fm).sort()).toEqual(["description", "name", "tools"]);
  });

  it("tells the agent the tools its frontmatter grants, and the commands it must not run", () => {
    const said = body(text).replace(/\s+/g, " ");
    expect(said).toContain(
      "You have Read, Grep, Glob, Bash, Write and Edit, and no MCP, web or agent tools.",
    );
    expect(said).toContain("Do not run `gh`, `git push`, `curl`, `wget`");
  });
});

describe("the bake-off workflow launches every agent as the read-only type", () => {
  const types = (calls: AgentCall[]) => calls.map((c) => c.opts.agentType);

  it("the gold and every arm of a whole-task run", async () => {
    const { calls } = await runWorkflow(extractArgs(census, "/r/input"));
    expect(calls).toHaveLength(1 + census.arms.length);
    expect(types(calls)).toEqual(calls.map(() => TYPE));
  });

  it("every agent of an item run", async () => {
    const args = extractArgs(refute, "/r/input", refute.arms, "/r/work");
    const { calls } = await runWorkflow({ ...args, only: ["gold", "haiku-medium-1"] });
    expect(calls).toHaveLength(2 * refute.items("/r/input").length);
    expect(types(calls)).toEqual(calls.map(() => TYPE));
  });

  it("every referee chunk", async () => {
    const chunk = [{ id: "d1", check: "f", ARM: "a", REFERENCE: "b" }];
    const { calls } = await runWorkflow({
      mode: "referee",
      task: census.id,
      dir: "/r/input",
      work: "/r/work",
      prompt: census.prompt("/r/input"),
      round: 1,
      referee: REFEREE,
      chunks: [chunk, chunk],
    });
    expect(calls).toHaveLength(2);
    expect(types(calls)).toEqual([TYPE, TYPE]);
  });
});

describe("score holds every agent to the read-only type", () => {
  const dir = mkdtempSync(join(tmpdir(), "bakeoff-agent-type-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const line = (o: unknown) => JSON.stringify(o);
  const text = [
    line({ message: { role: "user", content: "task\n\n(BAKEOFF-ARM: a)" } }),
    line({
      effort: "low",
      message: {
        id: "m",
        model: "claude-haiku-5-5",
        role: "assistant",
        content: [{ type: "tool_use", id: "so", name: "StructuredOutput", input: {} }],
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    }),
  ].join("\n");
  // The harness writes agent-<id>.meta.json beside each subagent's agent-<id>.jsonl.
  const transcript = (id: string, meta?: unknown) => {
    writeFileSync(join(dir, `agent-${id}.jsonl`), text);
    if (meta !== undefined) writeFileSync(join(dir, `agent-${id}.meta.json`), line(meta));
    return collectFile(join(dir, `agent-${id}.jsonl`));
  };
  const arm = { id: "a", model: "haiku", effort: "low" };

  it("reads the agent type from the transcript's .meta.json", () => {
    expect(transcript("ro", { agentType: TYPE, description: "arm:a" }).agentType).toBe(TYPE);
    expect(transcript("wf", { agentType: "workflow-subagent" }).agentType).toBe(
      "workflow-subagent",
    );
    expect(transcript("none").agentType).toBeNull();
  });

  it("records no type for a meta file that is not JSON, not an object or names none", () => {
    writeFileSync(join(dir, "agent-bad.meta.json"), "{");
    writeFileSync(join(dir, "agent-bad.jsonl"), text);
    expect(collectFile(join(dir, "agent-bad.jsonl")).agentType).toBeNull();
    for (const [id, meta] of [
      ["null", null],
      ["empty", {}],
      ["number", { agentType: 5 }],
      ["blank", { agentType: "" }],
    ] as const)
      expect(transcript(id, meta).agentType, id).toBeNull();
  });

  it("refuses a path that is not a .jsonl transcript", () => {
    expect(() => collectFile(join(dir, "agent-ro.meta.json"))).toThrow(/not a \.jsonl transcript/);
  });

  it("passes an agent of the type, and reports one of another type or none", () => {
    expect(verifyRan(arm, transcript("ro2", { agentType: TYPE }))).toEqual([]);
    expect(verifyRan(arm, transcript("wf2", { agentType: "workflow-subagent" }))).toEqual([
      "a: ran as agent type workflow-subagent, not bakeoff-readonly",
    ]);
    expect(verifyRan(arm, transcript("none2"))).toEqual([
      "a: no agent type recorded (its .meta.json is missing, unreadable or names none), so it cannot be shown to be bakeoff-readonly",
    ]);
  });
});

describe("collect keeps each agent's type for score", () => {
  const CLI = fileURLToPath(new URL("../../scripts/model-bakeoff/bakeoff.mjs", import.meta.url));
  const run = mkdtempSync(join(tmpdir(), "bakeoff-collect-type-"));
  afterAll(() => rmSync(run, { recursive: true, force: true }));
  const args = {
    task: "t",
    dir: join(run, "input"),
    work: join(run, "work"),
    gold: { id: "gold", model: "haiku", effort: "low" },
    arms: [{ id: "a", model: "haiku", effort: "low" }],
  };
  const transcripts = join(run, "transcripts", "wf_x");
  const write = (file: string, marker: string, meta?: string) => {
    const prompt = `Task over ${args.dir}.\nYour own scratch directory is ${args.work}/${file}.${marker}`;
    writeFileSync(
      join(transcripts, `agent-${file}.jsonl`),
      JSON.stringify({ message: { role: "user", content: prompt } }),
    );
    if (meta !== undefined) writeFileSync(join(transcripts, `agent-${file}.meta.json`), meta);
  };

  it("writes the type from each .meta.json into runs.json, past a stray unreadable one", () => {
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(run, "workflow-args.json"), JSON.stringify(args));
    write("gold", "\n\n(BAKEOFF-ARM: gold)", JSON.stringify({ agentType: TYPE }));
    write("a", "\n\n(BAKEOFF-ARM: a)", JSON.stringify({ agentType: "workflow-subagent" }));
    write("stray", "", "{");
    execFileSync(process.execPath, [CLI, "collect", "--run", run, "--transcripts", transcripts], {
      encoding: "utf8",
    });
    // Beside the run, never inside it, where a later arm could read the gold's output (#1540).
    expect(existsSync(join(run, "runs.json"))).toBe(false);
    const runs = JSON.parse(readFileSync(runsPath(run), "utf8"));
    expect(Object.keys(runs).sort()).toEqual(["a", "gold"]);
    expect(runs.gold.agentType).toBe(TYPE);
    expect(runs.a.agentType).toBe("workflow-subagent");
  });

  it("refuses to merge into a run still holding runs.json, referee-args.json or result.json (#1540)", () => {
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(run, "workflow-args.json"), JSON.stringify(args));
    write("gold", "\n\n(BAKEOFF-ARM: gold)", JSON.stringify({ agentType: TYPE }));
    for (const name of ["runs.json", "referee-args.json", "result.json"]) {
      writeFileSync(join(run, name), "{}\n");
      let err = "";
      try {
        execFileSync(
          process.execPath,
          [CLI, "collect", "--run", run, "--transcripts", transcripts],
          {
            encoding: "utf8",
            stdio: "pipe",
          },
        );
      } catch (e) {
        err = String((e as { stderr: string }).stderr);
      } finally {
        rmSync(join(run, name));
      }
      expect(err).toContain(`${join(run, name)} is inside the run`);
    }
  });
});
