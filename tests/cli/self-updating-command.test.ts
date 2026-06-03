import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runSelfUpdatingCommand } from "../../src/cli/commands/self-updating.js";

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
});
