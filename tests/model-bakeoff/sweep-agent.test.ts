import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// P1-56: the `sweep` agent routes mechanical census and inventory sweeps to Haiku 5.5 at
// `medium`, the cheapest arm that matched gold on 456/456 checks in the 2026-10-19 row-4
// bake-off (reddoorla/reddoor-workspace#1). Claude Code reads these frontmatter keys from
// `.claude/agents/*.md`; a missing `effort` inherits the session's (`xhigh` on the laptop), and
// a missing `tools` inherits every tool, MCP writes included.
const AGENT = fileURLToPath(new URL("../../.claude/agents/sweep.md", import.meta.url));

function frontmatter(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("sweep.md has no frontmatter block");
  return yaml.load(match[1] ?? "") as Record<string, unknown>;
}

function toolList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

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
    const body = text.slice(text.indexOf("\n---\n", 4) + 5);
    expect(body).toMatch(/census/i);
  });
});
