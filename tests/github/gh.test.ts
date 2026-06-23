import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";
import type { SpawnFn, SpawnResult, SpawnOptions } from "../../src/audits/util/spawn.js";

function fakeSpawn(result: Partial<SpawnResult>): {
  spawn: SpawnFn;
  calls: Array<{ cmd: string; args: string[]; opts: SpawnOptions }>;
} {
  const calls: Array<{ cmd: string; args: string[]; opts: SpawnOptions }> = [];
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
    expect(calls[0]!.opts.env?.GH_TOKEN).toBe("T");
  });

  it("openPullRequests queries the GraphQL rollup and normalizes CI state per PR", async () => {
    const stdout = JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 11,
                title: "chore(deps): bump vite",
                url: "https://github.com/o/r/pull/11",
                headRefName: "renovate/npm-vite",
                commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
              },
              {
                number: 12,
                title: "feat: thing",
                url: "https://github.com/o/r/pull/12",
                headRefName: "feature/thing",
                commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
              },
            ],
          },
        },
      },
    });
    const { spawn, calls } = fakeSpawn({ stdout });
    const prs = await makeGitHub({ token: "T", spawn }).openPullRequests("o/r");

    expect(prs).toEqual([
      {
        number: 11,
        title: "chore(deps): bump vite",
        url: "https://github.com/o/r/pull/11",
        headRef: "renovate/npm-vite",
        ciState: "failing",
      },
      {
        number: 12,
        title: "feat: thing",
        url: "https://github.com/o/r/pull/12",
        headRef: "feature/thing",
        ciState: "none",
      },
    ]);
    expect(calls[0]!.args.slice(0, 2)).toEqual(["api", "graphql"]);
    const joined = calls[0]!.args.join(" ");
    expect(joined).toContain("owner=o");
    expect(joined).toContain("name=r");
    // pin the query shape the mock can't vouch for: rollup field, page cap, newest-first
    expect(joined).toContain("statusCheckRollup");
    expect(joined).toContain("first:100");
    expect(joined).toContain("orderBy:{field:CREATED_AT,direction:DESC}");
    expect(calls[0]!.opts.env?.GH_TOKEN).toBe("T");
  });

  it("openPullRequests normalizes every rollup state", async () => {
    const node = (state: string | null) => ({
      number: 1,
      title: "t",
      url: "u",
      headRefName: "h",
      commits: { nodes: [{ commit: { statusCheckRollup: state === null ? null : { state } } }] },
    });
    const stdout = JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes: [
              node("SUCCESS"),
              node("FAILURE"),
              node("ERROR"),
              node("PENDING"),
              node("EXPECTED"),
              node(null),
            ],
          },
        },
      },
    });
    const { spawn } = fakeSpawn({ stdout });
    const prs = await makeGitHub({ token: "T", spawn }).openPullRequests("o/r");
    expect(prs.map((p) => p.ciState)).toEqual([
      "passing",
      "failing",
      "failing",
      "pending",
      "pending",
      "none",
    ]);
  });

  it("openPullRequests rejects a malformed repo identifier", async () => {
    const { spawn } = fakeSpawn({ stdout: "{}" });
    await expect(makeGitHub({ token: "T", spawn }).openPullRequests("not-a-repo")).rejects.toThrow(
      /owner\/repo/,
    );
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

  it("filesOnBranch returns the subset of paths that exist (code 0)", async () => {
    const { spawn, calls } = fakeSpawn({ code: 0 });
    const gh = makeGitHub({ token: "T", spawn });
    const present = await gh.filesOnBranch("o/r", "main", [
      ".github/workflows/ci.yml",
      "renovate.json",
    ]);
    expect(present).toEqual([".github/workflows/ci.yml", "renovate.json"]);
    expect(calls[0]!.args).toEqual(["api", "repos/o/r/contents/.github/workflows/ci.yml?ref=main"]);
    expect(calls[1]!.args).toEqual(["api", "repos/o/r/contents/renovate.json?ref=main"]);
  });

  it("filesOnBranch treats non-zero (404) as absent", async () => {
    const { spawn } = fakeSpawn({ code: 1 });
    const present = await makeGitHub({ token: "T", spawn }).filesOnBranch("o/r", "main", [
      "renovate.json",
    ]);
    expect(present).toEqual([]);
  });

  it("branchProtectionContexts parses required contexts; [] on 404", async () => {
    const ok = fakeSpawn({ code: 0, stdout: "ci\nbuild\n" });
    expect(
      await makeGitHub({ token: "T", spawn: ok.spawn }).branchProtectionContexts("o/r", "main"),
    ).toEqual(["ci", "build"]);
    expect(ok.calls[0]!.args).toEqual([
      "api",
      "repos/o/r/branches/main/protection",
      "--jq",
      ".required_status_checks.contexts[]?",
    ]);
    const missing = fakeSpawn({ code: 1, stderr: "Not Found" });
    expect(
      await makeGitHub({ token: "T", spawn: missing.spawn }).branchProtectionContexts(
        "o/r",
        "main",
      ),
    ).toEqual([]);
  });

  it("secretExists checks the secret name list", async () => {
    const has = fakeSpawn({ code: 0, stdout: "RENOVATE_TOKEN\nOTHER\n" });
    expect(
      await makeGitHub({ token: "T", spawn: has.spawn }).secretExists("o/r", "RENOVATE_TOKEN"),
    ).toBe(true);
    // per_page=100: the REST default of 30 would false-negative on a repo with >30 secrets,
    // making setRepoSecret needlessly overwrite an already-present one.
    expect(has.calls[0]!.args).toEqual([
      "api",
      "repos/o/r/actions/secrets?per_page=100",
      "--jq",
      ".secrets[].name",
    ]);
    const none = fakeSpawn({ code: 0, stdout: "OTHER\n" });
    expect(
      await makeGitHub({ token: "T", spawn: none.spawn }).secretExists("o/r", "RENOVATE_TOKEN"),
    ).toBe(false);
  });

  it("autoMergeEnabled reads .allow_auto_merge", async () => {
    const on = fakeSpawn({ code: 0, stdout: "true\n" });
    expect(await makeGitHub({ token: "T", spawn: on.spawn }).autoMergeEnabled("o/r")).toBe(true);
    expect(on.calls[0]!.args).toEqual(["api", "repos/o/r", "--jq", ".allow_auto_merge"]);
    const off = fakeSpawn({ code: 0, stdout: "false\n" });
    expect(await makeGitHub({ token: "T", spawn: off.spawn }).autoMergeEnabled("o/r")).toBe(false);
  });

  it("findOpenSelfUpdatingPR returns the first matching PR url or null", async () => {
    const found = fakeSpawn({ code: 0, stdout: "https://github.com/o/r/pull/9\n" });
    expect(await makeGitHub({ token: "T", spawn: found.spawn }).findOpenSelfUpdatingPR("o/r")).toBe(
      "https://github.com/o/r/pull/9",
    );
    // per_page=100: with the REST default of 30, a repo with >30 open PRs (plausible under
    // Renovate) could page past the self-updating PR and open a duplicate.
    expect(found.calls[0]!.args).toEqual([
      "api",
      "repos/o/r/pulls?state=open&per_page=100",
      "--jq",
      '.[] | select(.head.ref | startswith("maint/self-updating-")) | .html_url',
    ]);
    const none = fakeSpawn({ code: 0, stdout: "" });
    expect(
      await makeGitHub({ token: "T", spawn: none.spawn }).findOpenSelfUpdatingPR("o/r"),
    ).toBeNull();
  });

  describe("URL-segment guard (defense in depth)", () => {
    it("accepts legit branch names and file paths", async () => {
      // A realistic maint branch + a nested workflow path must not trip the guard.
      const a = fakeSpawn({ code: 0, stdout: "ci\n" });
      await expect(
        makeGitHub({ token: "T", spawn: a.spawn }).branchProtectionContexts(
          "o/r",
          "maint/self-updating-x",
        ),
      ).resolves.toBeDefined();
      const b = fakeSpawn({ code: 0 });
      await expect(
        makeGitHub({ token: "T", spawn: b.spawn }).filesOnBranch("o/r", "main", [
          ".github/workflows/ci.yml",
        ]),
      ).resolves.toEqual([".github/workflows/ci.yml"]);
    });

    it("rejects a branch with traversal / structural chars before hitting gh", async () => {
      for (const branch of ["../../secrets", "main?x=1", "ma in", "/leading", "a#b", "a\\b"]) {
        const { spawn, calls } = fakeSpawn({ code: 0 });
        await expect(
          makeGitHub({ token: "T", spawn }).protectBranch("o/r", branch, ["ci"]),
        ).rejects.toThrow(/unsafe branch/i);
        expect(calls).toEqual([]); // never reached the gh call
        await expect(
          makeGitHub({ token: "T", spawn }).branchProtectionContexts("o/r", branch),
        ).rejects.toThrow(/unsafe branch/i);
      }
    });

    it("rejects a file path with traversal / structural chars before hitting gh", async () => {
      for (const path of ["../etc/passwd", ".github/wf.yml?ref=evil", "/abs", "a b", "x#y"]) {
        const { spawn, calls } = fakeSpawn({ code: 0 });
        await expect(
          makeGitHub({ token: "T", spawn }).filesOnBranch("o/r", "main", [path]),
        ).rejects.toThrow(/unsafe path/i);
        expect(calls).toEqual([]);
      }
    });
  });
});
