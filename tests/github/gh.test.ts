import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";
import type { SpawnFn, SpawnResult } from "../../src/audits/util/spawn.js";

function fakeSpawn(result: Partial<SpawnResult>): {
  spawn: SpawnFn;
  calls: Array<{ cmd: string; args: string[]; opts: any }>;
} {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = [];
  const spawn: SpawnFn = async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts: opts ?? {} });
    return { code: 0, stdout: "", stderr: "", ...result };
  };
  return { spawn, calls };
}

describe("makeGitHub", () => {
  it("openPullRequest calls gh pr create with the token in env and returns the URL", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: "https://github.com/o/r/pull/7\n" });
    const gh = makeGitHub({ token: "T", spawn });
    const out = await gh.openPullRequest("o/r", {
      head: "maint/x",
      base: "main",
      title: "t",
      body: "b",
    });
    expect(out).toEqual({ url: "https://github.com/o/r/pull/7" });
    expect(calls[0]!.cmd).toBe("gh");
    expect(calls[0]!.args).toEqual([
      "pr",
      "create",
      "--repo",
      "o/r",
      "--head",
      "maint/x",
      "--base",
      "main",
      "--title",
      "t",
      "--body",
      "b",
    ]);
    expect(calls[0]!.opts.env.GH_TOKEN).toBe("T");
  });

  it("enableRepoAutoMerge PATCHes allow_auto_merge", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).enableRepoAutoMerge("o/r");
    expect(calls[0]!.args).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/o/r",
      "-F",
      "allow_auto_merge=true",
    ]);
  });

  it("protectBranch requires the named checks", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci"]);
    const joined = calls[0]!.args.join(" ");
    expect(calls[0]!.args[0]).toBe("api");
    expect(calls[0]!.args).toContain("PUT");
    expect(joined).toContain("repos/o/r/branches/main/protection");
    expect(joined).toContain("ci");
  });

  it("setRepoSecret calls gh secret set", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).setRepoSecret("o/r", "RENOVATE_TOKEN", "v");
    expect(calls[0]!.args).toEqual([
      "secret",
      "set",
      "RENOVATE_TOKEN",
      "--repo",
      "o/r",
      "--body",
      "v",
    ]);
  });

  it("repoExists returns true on code 0 and false on non-zero", async () => {
    expect(
      await makeGitHub({ token: "T", spawn: fakeSpawn({ code: 0 }).spawn }).repoExists("o/r"),
    ).toBe(true);
    expect(
      await makeGitHub({ token: "T", spawn: fakeSpawn({ code: 1 }).spawn }).repoExists("o/r"),
    ).toBe(false);
  });

  it("defaultBranch reads .default_branch via --jq", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: "main\n" });
    const b = await makeGitHub({ token: "T", spawn }).defaultBranch("o/r");
    expect(b).toBe("main");
    expect(calls[0]!.args).toEqual(["api", "repos/o/r", "--jq", ".default_branch"]);
  });

  it("throws on non-zero exit (for the mutating wrappers)", async () => {
    const { spawn } = fakeSpawn({ code: 1, stderr: "boom" });
    await expect(makeGitHub({ token: "T", spawn }).enableRepoAutoMerge("o/r")).rejects.toThrow(
      "boom",
    );
  });
});
