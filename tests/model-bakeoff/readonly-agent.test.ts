import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { body, frontmatter, toolList } from "../_helpers/agent-frontmatter.js";
import { runWorkflow, type AgentCall } from "../_helpers/bakeoff-workflow.js";
import { AGENT_TYPE } from "../../scripts/model-bakeoff/lib/arms.mjs";
import { REFEREE, extractArgs } from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";
import * as refute from "../../scripts/model-bakeoff/tasks/refute-repo.mjs";

// Operator decisions 133 (c): every bake-off agent (arm, gold and referee) runs as the
// `bakeoff-readonly` agent type, whose permission rules refuse gh, git push, curl and wget
// before they run. Until 2026-10-20 "read-only" was prompt text, checked after the run by a
// tripwire over each Bash command, and seven review rounds on #1444 kept finding shell forms it
// missed. The probe showing these rules bind a Workflow agent() subagent, with the default
// agent as the negative control, is in the PR that added this file. A workflow agent() with no
// `agentType` runs as the default agent, which has every tool and no such rule.
const TYPE = "bakeoff-readonly";
const AGENT = fileURLToPath(new URL(`../../.claude/agents/${TYPE}.md`, import.meta.url));

describe(".claude/agents/bakeoff-readonly.md", () => {
  const text = readFileSync(AGENT, "utf8");
  const fm = frontmatter(text);

  it("is the agent type the workflow launches", () => {
    expect(fm.name).toBe(TYPE);
    expect(AGENT_TYPE).toBe(TYPE);
  });

  it("denies gh, git push, curl and wget in Bash", () => {
    expect(toolList(fm.disallowedTools).sort()).toEqual([
      "Bash(curl *)",
      "Bash(gh *)",
      "Bash(git push *)",
      "Bash(wget *)",
    ]);
  });

  it("keeps Bash, which pnpm-update, t4 and every gold and referee use, and no MCP, web or agent tool", () => {
    expect(toolList(fm.tools).sort()).toEqual(["Bash", "Edit", "Glob", "Grep", "Read", "Write"]);
  });

  it("leaves model and effort to each launch, and sets no key that could widen its permissions", () => {
    expect(Object.keys(fm).sort()).toEqual(["description", "disallowedTools", "name", "tools"]);
  });

  it("tells the agent what its frontmatter denies", () => {
    expect(body(text).replace(/\s+/g, " ")).toContain(
      "In Bash, `gh`, `git push`, `curl` and `wget` are denied",
    );
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
