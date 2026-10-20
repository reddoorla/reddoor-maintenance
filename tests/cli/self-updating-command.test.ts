import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runSelfUpdatingCommand } from "../../src/cli/commands/self-updating.js";
import { selfUpdating } from "../../src/recipes/self-updating/index.js";
import type { RecipeResult } from "../../src/types.js";

// The recipe itself is covered by tests/recipes/self-updating.test.ts; here it is
// stubbed so the command's own output formatting can be pinned (#1433).
vi.mock("../../src/recipes/self-updating/index.js", () => ({ selfUpdating: vi.fn() }));
const selfUpdatingMock = vi.mocked(selfUpdating);

beforeEach(() => {
  selfUpdatingMock.mockReset();
});

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "su-cmd-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/o/r.git"], { cwd: dir });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "r" }));
  return dir;
}

describe("runSelfUpdatingCommand", () => {
  it("--dry reports without touching GitHub and exits 0", async () => {
    const dir = gitRepo();
    const res = await runSelfUpdatingCommand(dir, { dry: true });
    expect(res.code).toBe(0);
    expect(res.output.toLowerCase()).toContain("would");
    expect(res.output).toContain("self-updating");
  });

  // #1433: the command passes { noopNote: "already self-updating", commitCount: false }
  // to formatRecipeResult. These pin both options at the command level.
  it("prints an applied result as a bare `applied`, with no commit count", async () => {
    const dir = gitRepo();
    const applied: RecipeResult = {
      recipe: "self-updating",
      site: "r",
      status: "applied",
      commits: ["a1", "b2"],
      notes: "renovate.json added",
    };
    selfUpdatingMock.mockResolvedValueOnce(applied);
    const res = await runSelfUpdatingCommand(dir, {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("[r] applied\nrenovate.json added");
    expect(res.output).not.toContain("commit(s)");
  });

  it("prints a noop result with no notes as `noop: already self-updating`", async () => {
    const dir = gitRepo();
    selfUpdatingMock.mockResolvedValueOnce({
      recipe: "self-updating",
      site: "r",
      status: "noop",
      commits: [],
    });
    const res = await runSelfUpdatingCommand(dir, {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("[r] noop: already self-updating");
  });
});
