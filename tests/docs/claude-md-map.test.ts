import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `scripts/claude-md-map.mjs` checks that a map table accounts for every `##`/`###` heading and
 * every bold lead (a bold span opening a paragraph or list item) of a CLAUDE.md, outside code
 * fences. P1-33 W4 moved most of this repo's CLAUDE.md to `reddoorla/reddoor-workspace`; the map
 * there says where each rule went, and the operator reads its "dropped" rows. The PASS control
 * runs first (reddoor-workspace CLAUDE.md, "Prove the instrument before you trust its verdict").
 */

const SCRIPT = fileURLToPath(new URL("../../scripts/claude-md-map.mjs", import.meta.url));

const SOURCE = [
  "# CLAUDE.md",
  "",
  "## First rule",
  "",
  "- **Do the thing.** Because.",
  "- Plain item with **inline bold** only.",
  "",
  "  **Indented lead** (the operator).",
  "",
  "```sh",
  "## Fenced heading",
  "**Fenced bold**",
  "```",
  "",
  "### Second rule",
  "",
  "**A lead that",
  "wraps.** Then text.",
  "",
].join("\n");

const MAP = [
  "| # | At X | Where it went |",
  "|---|---|---|",
  "| 1 | H: First rule | kept: maint |",
  "| 2 | B: Do the thing. | moved: home |",
  "| 3 | B: Indented lead | dropped: reason |",
  "| 4 | H: Second rule | operator: keep or drop? |",
  "| 5 | B: A lead that wraps. | moved: home |",
  "| 6 | R: a rule with no lead | kept: maint |",
  "",
].join("\n");

const dirs: string[] = [];

function run(source: string, map: string) {
  const dir = mkdtempSync(join(tmpdir(), "claude-md-map-"));
  dirs.push(dir);
  writeFileSync(join(dir, "s.md"), source);
  writeFileSync(join(dir, "m.md"), map);
  const r = spawnSync(
    process.execPath,
    [SCRIPT, "--source", join(dir, "s.md"), "--map", join(dir, "m.md")],
    {
      encoding: "utf8",
    },
  );
  return { status: r.status, out: r.stdout };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("scripts/claude-md-map.mjs", () => {
  it("passes a map that covers every heading and lead (PASS control)", () => {
    const r = run(SOURCE, MAP);
    expect(r.out).toContain("claude-md-map: source=5 rows=6 unmapped=0 problems=0");
    expect(r.status).toBe(0);
  });

  it("fails when one row is deleted, naming the rule", () => {
    const r = run(SOURCE, MAP.replace(/^\| 3 .*\n/m, ""));
    expect(r.status).toBe(1);
    expect(r.out).toContain("unmapped B: Indented lead");
  });

  it("fails on a row whose rule no longer exists at X", () => {
    const r = run(SOURCE, MAP.replace("B: Do the thing.", "B: Do another thing."));
    expect(r.status).toBe(1);
    expect(r.out).toContain("unmapped B: Do the thing.");
    expect(r.out).toMatch(/stale map:4 B: Do another thing\./);
  });

  it("fails on a row with no kept, moved, dropped or operator destination", () => {
    const r = run(SOURCE, MAP.replace("kept: maint |", "somewhere |"));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/no destination map:3 H: First rule/);
  });

  it("fails on an empty source, which would map vacuously", () => {
    const r = run("", "| # | At X | Where |\n|---|---|---|\n");
    expect(r.status).toBe(1);
    expect(r.out).toContain("source=0");
  });
});
