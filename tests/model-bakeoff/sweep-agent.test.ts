import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { body, frontmatter, toolList } from "../_helpers/agent-frontmatter.js";

// P1-56: the `sweep` agent routes mechanical census and inventory sweeps to Haiku 5.5 at
// `medium` with only Read, Grep and Glob, the configuration that scored 228/228 in each of two
// read-only runs of the 2026-10-19 row-4 census (P1-56's result comment on
// reddoorla/reddoor-workspace#1). The row-4 bake-off's own Haiku arms, at 456/456 for `medium`,
// also had Bash and Write, so they are not this configuration. Claude Code reads these frontmatter keys from
// `.claude/agents/*.md`; a missing `effort` inherits the session's (`xhigh` on the laptop), and
// a missing `tools` inherits every tool, MCP writes included.
const AGENT = fileURLToPath(new URL("../../.claude/agents/sweep.md", import.meta.url));

describe(".claude/agents/sweep.md", () => {
  const text = readFileSync(AGENT, "utf8");
  const fm = frontmatter(text);

  it("runs on Haiku at an explicit medium effort", () => {
    expect(fm.name).toBe("sweep");
    expect(fm.model).toBe("haiku");
    expect(fm.effort).toBe("medium");
  });

  it("names its tools explicitly, and they are read-only", () => {
    expect(toolList(fm.tools).sort()).toEqual(["Glob", "Grep", "Read"]);
  });

  it("sets no key that could widen its tools or permissions", () => {
    expect(Object.keys(fm).sort()).toEqual(["description", "effort", "model", "name", "tools"]);
  });

  it("has a description and a body that say what it is for", () => {
    expect(String(fm.description)).toMatch(/census|inventory|sweep/i);
    expect(body(text)).toMatch(/census/i);
  });

  it("tells the agent the same tools its frontmatter grants", () => {
    expect(body(text)).toContain(
      "You are read-only. You have Read, Grep and Glob, and no other tools",
    );
  });
});
