import { afterAll, describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("passes an agent of the type, and reports one of another type or none", () => {
    expect(verifyRan(arm, transcript("ro2", { agentType: TYPE }))).toEqual([]);
    expect(verifyRan(arm, transcript("wf2", { agentType: "workflow-subagent" }))).toEqual([
      "a: ran as agent type workflow-subagent, not bakeoff-readonly",
    ]);
    expect(verifyRan(arm, transcript("none2"))).toEqual([
      "a: ran as agent type unrecorded (no .meta.json), not bakeoff-readonly",
    ]);
  });
});
