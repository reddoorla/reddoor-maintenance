import yaml from "js-yaml";

/** The YAML frontmatter of a `.claude/agents/*.md` file. */
export function frontmatter(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("the agent file has no frontmatter block");
  return yaml.load(match[1] ?? "") as Record<string, unknown>;
}

/** A frontmatter tool list, written as a comma-separated string or as a YAML list. */
export function toolList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

/** The agent file's body: everything after the frontmatter, which becomes its system prompt. */
export function body(text: string): string {
  return text.slice(text.indexOf("\n---\n", 4) + 5);
}
