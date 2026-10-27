import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { makeGitHub, ProtectionRefusedError, protectionPutBody } from "../../src/github/gh.js";
import { renovateOutcome, resolveBlockedBranches } from "../../src/audits/protection-coverage.js";
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
  it("openPullRequest POSTs to the REST pulls endpoint (never GraphQL) with the token in env", async () => {
    // `gh pr create` goes through GraphQL, which the cloud proxy refuses.
    const calls: Array<{ args: string[]; body: unknown; env: NodeJS.ProcessEnv | undefined }> = [];
    const spawn: SpawnFn = async (_cmd, args, opts) => {
      const i = args.indexOf("--input");
      const body = i >= 0 ? JSON.parse(readFileSync(args[i + 1]!, "utf-8")) : null;
      calls.push({ args: [...args], body, env: opts?.env });
      return { code: 0, stdout: '{"html_url":"https://github.com/o/r/pull/7"}', stderr: "" };
    };
    const out = await makeGitHub({ token: "T", spawn }).openPullRequest("o/r", {
      head: "maint/x",
      base: "main",
      title: "t",
      body: "b",
    });
    expect(out).toEqual({ url: "https://github.com/o/r/pull/7" });
    expect(calls[0]!.args.slice(0, 4)).toEqual(["api", "-X", "POST", "repos/o/r/pulls"]);
    expect(calls[0]!.args).not.toContain("graphql");
    expect(calls[0]!.body).toEqual({ head: "maint/x", base: "main", title: "t", body: "b" });
    expect(calls[0]!.env?.GH_TOKEN).toBe("T");
  });

  it("openPullRequest fails loudly when the response has no html_url", async () => {
    const { spawn } = fakeSpawn({ stdout: "{}" });
    await expect(
      makeGitHub({ token: "T", spawn }).openPullRequest("o/r", {
        head: "h",
        base: "main",
        title: "t",
        body: "b",
      }),
    ).rejects.toThrow(/no html_url/);
  });

  it("openPullRequestRefs lists open PRs over REST and keeps head ref + url", async () => {
    const { spawn, calls } = fakeSpawn({
      stdout: JSON.stringify([
        { headRef: "maint/prismic-ci-1", url: "https://github.com/o/r/pull/3" },
        { headRef: null, url: "https://github.com/o/r/pull/4" },
      ]),
    });
    const refs = await makeGitHub({ token: "T", spawn }).openPullRequestRefs("o/r");
    expect(refs).toEqual([{ headRef: "maint/prismic-ci-1", url: "https://github.com/o/r/pull/3" }]);
    expect(calls[0]!.args[0]).toBe("api");
    expect(calls[0]!.args[1]).toBe("repos/o/r/pulls?state=open&per_page=100");
    expect(calls[0]!.args).not.toContain("graphql");
  });

  it("the REST PR methods reject a malformed repo before calling gh", async () => {
    const { spawn, calls } = fakeSpawn({});
    const gh = makeGitHub({ token: "T", spawn });
    await expect(gh.openPullRequestRefs("not-a-repo")).rejects.toThrow(/owner\/repo/);
    await expect(
      gh.openPullRequest("a/b/c", { head: "h", base: "main", title: "t", body: "b" }),
    ).rejects.toThrow(/owner\/repo/);
    expect(calls).toEqual([]);
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
                mergeable: "MERGEABLE",
                commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
              },
              {
                number: 12,
                title: "feat: thing",
                url: "https://github.com/o/r/pull/12",
                headRefName: "feature/thing",
                mergeable: "CONFLICTING",
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
        mergeable: "MERGEABLE",
      },
      {
        number: 12,
        title: "feat: thing",
        url: "https://github.com/o/r/pull/12",
        headRef: "feature/thing",
        ciState: "none",
        mergeable: "CONFLICTING",
      },
    ]);
    expect(calls[0]!.args.slice(0, 2)).toEqual(["api", "graphql"]);
    const joined = calls[0]!.args.join(" ");
    expect(joined).toContain("owner=o");
    expect(joined).toContain("name=r");
    // pin the query shape the mock can't vouch for: rollup field, page cap, newest-first
    expect(joined).toContain("statusCheckRollup");
    expect(joined).toContain("mergeable");
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

  it("disableRepoAutoMerge PATCHes allow_auto_merge=false", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).disableRepoAutoMerge("o/r");
    expect(calls[0]!.args).toEqual([
      "api",
      "-X",
      "PATCH",
      "repos/o/r",
      "-F",
      "allow_auto_merge=false",
    ]);
  });

  it("setRepoSecret calls gh secret set", async () => {
    const { spawn, calls } = fakeSpawn({});
    await makeGitHub({ token: "T", spawn }).setRepoSecret("o/r", "SOME_SECRET", "v");
    expect(calls[0]!.args).toEqual([
      "secret",
      "set",
      "SOME_SECRET",
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

  it("fileContentsOnBranch returns the raw file content (code 0)", async () => {
    const { spawn, calls } = fakeSpawn({ code: 0, stdout: "line1\nline2\n" });
    const content = await makeGitHub({ token: "T", spawn }).fileContentsOnBranch(
      "o/r",
      "main",
      "renovate.json",
    );
    expect(content).toBe("line1\nline2\n");
    // raw media type → bytes verbatim (no base64 envelope) for an exact content compare
    expect(calls[0]!.args).toEqual([
      "api",
      "repos/o/r/contents/renovate.json?ref=main",
      "-H",
      "Accept: application/vnd.github.raw",
    ]);
  });

  it("fileContentsOnBranch returns null when the file is absent (404)", async () => {
    const { spawn } = fakeSpawn({ code: 1, stderr: "gh: Not Found (HTTP 404)" });
    const content = await makeGitHub({ token: "T", spawn }).fileContentsOnBranch(
      "o/r",
      "main",
      "renovate.json",
    );
    expect(content).toBeNull();
  });

  it.each([
    ["a refusal", "gh: Resource not accessible by integration (HTTP 403)", /HTTP 403/],
    ["a server error", "gh: Server Error (HTTP 500)", /HTTP 500/],
    ["a network failure", "error connecting to api.github.com", /error connecting/],
  ])("fileContentsOnBranch throws on %s instead of reading it as absent", async (_, stderr, re) => {
    const { spawn } = fakeSpawn({ code: 1, stderr });
    await expect(
      makeGitHub({ token: "T", spawn }).fileContentsOnBranch("o/r", "main", "renovate.json"),
    ).rejects.toThrow(re);
  });

  it("branchProtectionContexts parses required contexts; [] only on 404 Branch not protected", async () => {
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
    const unprotected = fakeSpawn({ code: 1, stderr: "gh: Branch not protected (HTTP 404)" });
    expect(
      await makeGitHub({ token: "T", spawn: unprotected.spawn }).branchProtectionContexts(
        "o/r",
        "main",
      ),
    ).toEqual([]);
  });

  it.each([
    ["an integration refusal", "gh: Resource not accessible by integration (HTTP 403)", /HTTP 403/],
    [
      "a proxy refusal",
      "gh: Write access to this GitHub API path is not permitted through this proxy. (HTTP 403)",
      /HTTP 403/,
    ],
    ["a server error", "gh: Server Error (HTTP 500)", /HTTP 500/],
    ["a rate limit", "gh: API rate limit exceeded for installation. (HTTP 429)", /HTTP 429/],
    ["a hidden repo", "gh: Not Found (HTTP 404)", /Not Found/],
    ["a missing branch", "gh: Branch not found (HTTP 404)", /Branch not found/],
    ["a network failure", "error connecting to api.github.com", /error connecting/],
  ])(
    "branchProtectionContexts throws on %s instead of reading it as unprotected",
    async (_, stderr, re) => {
      const { spawn } = fakeSpawn({ code: 1, stderr });
      await expect(
        makeGitHub({ token: "T", spawn }).branchProtectionContexts("o/r", "main"),
      ).rejects.toThrow(re);
    },
  );

  it("secretExists checks the secret name list", async () => {
    const has = fakeSpawn({ code: 0, stdout: "SOME_SECRET\nOTHER\n" });
    expect(
      await makeGitHub({ token: "T", spawn: has.spawn }).secretExists("o/r", "SOME_SECRET"),
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
      await makeGitHub({ token: "T", spawn: none.spawn }).secretExists("o/r", "SOME_SECRET"),
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
        // fileContentsOnBranch shares the same guard — it must reject before any gh call too.
        const f2 = fakeSpawn({ code: 0 });
        await expect(
          makeGitHub({ token: "T", spawn: f2.spawn }).fileContentsOnBranch("o/r", "main", path),
        ).rejects.toThrow(/unsafe path/i);
        expect(f2.calls).toEqual([]);
      }
    });
  });

  describe("ruleset wrappers", () => {
    it("listRepoRulesets requests repo-sourced rulesets only and parses id/name rows", async () => {
      const { spawn, calls } = fakeSpawn({
        stdout: "20165584\tmain: reviewed changes only\n16762724\tMain Protection\n",
      });
      const out = await makeGitHub({ token: "T", spawn }).listRepoRulesets("o/r");
      expect(calls[0]!.args[1]).toBe("repos/o/r/rulesets?per_page=100&includes_parents=false");
      expect(out).toEqual([
        { id: 20165584, name: "main: reviewed changes only" },
        { id: 16762724, name: "Main Protection" },
      ]);
    });

    it("listRepoRulesets never fabricates a row from a tab-less or non-numeric line", async () => {
      const { spawn } = fakeSpawn({ stdout: "garbage-without-tab\nNaNid\talso bad\n7\tok\n" });
      const out = await makeGitHub({ token: "T", spawn }).listRepoRulesets("o/r");
      expect(out).toEqual([{ id: 7, name: "ok" }]);
    });

    it("updateRuleset PUTs (never PATCHes — PATCH 404s on this endpoint) the JSON body via --input", async () => {
      const { spawn, calls } = fakeSpawn({ code: 0 });
      const payload = {
        name: "x",
        target: "branch" as const,
        enforcement: "active" as const,
        bypass_actors: [],
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: [{ type: "deletion" }],
      };
      await makeGitHub({ token: "T", spawn }).updateRuleset("o/r", 42, payload);
      const args = calls[0]!.args;
      expect(args.slice(0, 4)).toEqual(["api", "-X", "PUT", "repos/o/r/rulesets/42"]);
      const inputIdx = args.indexOf("--input");
      expect(inputIdx).toBeGreaterThan(0);
      // The temp file is gone by now (finally-cleanup) — asserting the flag pair
      // is what pins the body-delivery mechanism.
      expect(args[inputIdx + 1]).toMatch(/body\.json$/);
    });

    it("createRuleset POSTs to the rulesets collection via --input", async () => {
      const { spawn, calls } = fakeSpawn({ code: 0 });
      await makeGitHub({ token: "T", spawn }).createRuleset("o/r", {
        name: "x",
        target: "branch",
        enforcement: "active",
        bypass_actors: [],
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: [],
      });
      expect(calls[0]!.args.slice(0, 4)).toEqual(["api", "-X", "POST", "repos/o/r/rulesets"]);
      expect(calls[0]!.args).toContain("--input");
    });

    it("checkContextObserved matches the exact check-run name and degrades failures to false", async () => {
      const hit = fakeSpawn({ stdout: "ci / ci\nci / deploy-preview-comment\n" });
      expect(
        await makeGitHub({ token: "T", spawn: hit.spawn }).checkContextObserved(
          "o/r",
          "main",
          "ci / ci",
        ),
      ).toBe(true);
      expect(hit.calls[0]!.args[1]).toBe("repos/o/r/commits/main/check-runs?per_page=100");

      const miss = fakeSpawn({ stdout: "build\n" });
      expect(
        await makeGitHub({ token: "T", spawn: miss.spawn }).checkContextObserved(
          "o/r",
          "main",
          "ci / ci",
        ),
      ).toBe(false);

      // 404/409 (empty repo, no commits on the ref) = "no evidence", the SAFE
      // direction — never a throw that would abort the recipe.
      const err = fakeSpawn({ code: 1, stderr: "HTTP 409: Git Repository is empty" });
      expect(
        await makeGitHub({ token: "T", spawn: err.spawn }).checkContextObserved(
          "o/r",
          "main",
          "ci / ci",
        ),
      ).toBe(false);
    });

    it("repoVisibility reads .visibility", async () => {
      const { spawn, calls } = fakeSpawn({ stdout: "private\n" });
      expect(await makeGitHub({ token: "T", spawn }).repoVisibility("o/r")).toBe("private");
      expect(calls[0]!.args).toEqual(["api", "repos/o/r", "--jq", ".visibility"]);
    });

    it("listOrgRepos paginates (the 30-per-page default is the false-'queue is empty' trap) and parses rows", async () => {
      const { spawn, calls } = fakeSpawn({
        stdout:
          "espada\tpublic\tfalse\tenabled\tenabled\n" +
          "the-tower\tprivate\tfalse\tdisabled\tdisabled\n" +
          // security_and_analysis missing entirely (token lacks admin read) —
          // jq's // "unavailable" default must land here, never an empty string.
          "reddoor-test\tprivate\ttrue\tunavailable\tunavailable\n",
      });
      const out = await makeGitHub({ token: "T", spawn }).listOrgRepos("reddoorla");
      expect(calls[0]!.args).toContain("--paginate");
      expect(calls[0]!.args).toContain("orgs/reddoorla/repos?per_page=100");
      expect(out).toEqual([
        {
          name: "espada",
          visibility: "public",
          archived: false,
          secretScanning: "enabled",
          pushProtection: "enabled",
        },
        {
          name: "the-tower",
          visibility: "private",
          archived: false,
          secretScanning: "disabled",
          pushProtection: "disabled",
        },
        {
          name: "reddoor-test",
          visibility: "private",
          archived: true,
          secretScanning: "unavailable",
          pushProtection: "unavailable",
        },
      ]);
    });

    it("workflowHealth: active + last SUCCESS parsed from the success-filtered probe; 404 = absent; other failures throw", async () => {
      // Two sequential gh calls: workflow GET (.state), then the runs probe.
      const seen: string[][] = [];
      let n = 0;
      const healthy = await makeGitHub({
        token: "T",
        spawn: async (_cmd, args) => {
          seen.push([...args]);
          return n++ === 0
            ? { code: 0, stdout: "active\n", stderr: "" }
            : { code: 0, stdout: "2026-08-02T13:00:00Z\n", stderr: "" };
        },
      }).workflowHealth("o/r", "renovate.yml");
      expect(healthy).toEqual({
        present: true,
        state: "active",
        lastSuccessAt: "2026-08-02T13:00:00Z",
      });
      // Pin BOTH probe paths + jq. The runs probe MUST be per-workflow (the
      // all-workflows /actions/runs endpoint returns the same shape, and a
      // live ci.yml would then mask a dead renovate.yml) and MUST filter to
      // status=success (a revoked credential still creates fresh FAILING runs
      // every tick — counting those as alive is the exact blindness here).
      expect(seen[0]![1]).toBe("repos/o/r/actions/workflows/renovate.yml");
      expect(seen[1]![1]).toBe(
        "repos/o/r/actions/workflows/renovate.yml/runs?status=success&per_page=1",
      );
      expect(seen[1]![3]).toBe('.workflow_runs[0].created_at // ""');

      let m = 0;
      const neverSucceeded = await makeGitHub({
        token: "T",
        spawn: async () =>
          m++ === 0
            ? { code: 0, stdout: "active\n", stderr: "" }
            : { code: 0, stdout: "\n", stderr: "" },
      }).workflowHealth("o/r", "renovate.yml");
      expect(neverSucceeded).toEqual({ present: true, state: "active", lastSuccessAt: null });

      const absent = fakeSpawn({ code: 1, stderr: "gh: Not Found (HTTP 404)" });
      expect(
        await makeGitHub({ token: "T", spawn: absent.spawn }).workflowHealth("o/r", "renovate.yml"),
      ).toEqual({ present: false });
      expect(absent.calls[0]!.args[1]).toBe("repos/o/r/actions/workflows/renovate.yml");

      // A non-404 failure must THROW (the audit turns it into a gap) — an
      // unreadable workflow silently reading as absent-or-fine is the exact
      // couldn't-verify-is-fine hole this sweep exists to kill.
      const err = fakeSpawn({ code: 1, stderr: "HTTP 500" });
      await expect(
        makeGitHub({ token: "T", spawn: err.spawn }).workflowHealth("o/r", "renovate.yml"),
      ).rejects.toThrow(/workflowHealth/);
    });

    it("dependencyDashboard: paginates, filters to the dashboard issue, and reports parsed sections", async () => {
      // A mutation to the jq selector or a dropped --paginate makes every repo
      // read {present:false}, which the audit deliberately treats as NOT a gap
      // — i.e. the whole surface goes silently clean. Nothing above this line
      // can see that, so the argv is pinned here.
      const body = [
        "## PR Edited (Blocked)",
        " - [ ] <!-- rebase-branch=renovate/all-minor-patch -->x",
        "## Frozen Updates",
        "",
      ].join("\n");
      const { spawn, calls } = fakeSpawn({ stdout: `${body}\n` });
      const dash = await makeGitHub({ token: "T", spawn }).dependencyDashboard("o/r");

      expect(dash).toEqual({
        present: true,
        blockedBranches: ["renovate/all-minor-patch"],
        unknownSections: ["Frozen Updates"],
      });
      // --paginate is load-bearing: /issues is newest-first and the dashboard
      // is typically the OLDEST open issue, so page 1 can miss it entirely.
      expect(calls[0]!.args).toContain("--paginate");
      expect(calls[0]!.args[2]).toBe("repos/o/r/issues?state=open&per_page=100");
      expect(calls[0]!.args[4]).toContain('select(.title == "Dependency Dashboard")');

      const empty = fakeSpawn({ stdout: "\n" });
      expect(
        await makeGitHub({ token: "T", spawn: empty.spawn }).dependencyDashboard("o/r"),
      ).toEqual({ present: false });
    });

    it("branchTip: classifies the tip author; a deleted branch is null, not an error", async () => {
      const { spawn, calls } = fakeSpawn({
        stdout: JSON.stringify({
          type: "User",
          login: "renovate-bot",
          email: "renovate-bot@whitesourcesoftware.com",
          name: "Renovate Bot",
          date: "2026-07-27T04:00:00Z",
        }),
      });
      // REGRESSION: `renovate-bot` — the retired identity whose orphaned
      // branches froze nine repos — is GitHub type `User`, so a Bot-type-only
      // rule would have missed the very incident this probe exists to catch.
      expect(
        await makeGitHub({ token: "T", spawn }).branchTip("o/r", "renovate/all-minor-patch"),
      ).toEqual({ authorIsMachine: true, committedAt: "2026-07-27T04:00:00Z" });
      // The ref segment keeps its literal `/` — GitHub resolves a percent-
      // encoded one as a filename, not a ref.
      expect(calls[0]!.args[1]).toBe("repos/o/r/commits/renovate/all-minor-patch");

      const gone = fakeSpawn({ code: 1, stderr: "gh: No commit found (HTTP 404)" });
      expect(await makeGitHub({ token: "T", spawn: gone.spawn }).branchTip("o/r", "x")).toBeNull();

      const err = fakeSpawn({ code: 1, stderr: "HTTP 500" });
      await expect(
        makeGitHub({ token: "T", spawn: err.spawn }).branchTip("o/r", "x"),
      ).rejects.toThrow();
    });

    it("REGRESSION P1-50: a branch the Dashboard names before Renovate creates it is null, not a failed probe", async () => {
      const missing = fakeSpawn({
        code: 1,
        stderr: "gh: No commit found for SHA: renovate/staging-major-vitest-monorepo (HTTP 422)",
      });
      const github = makeGitHub({ token: "T", spawn: missing.spawn });
      expect(await github.branchTip("o/r", "renovate/staging-major-vitest-monorepo")).toBeNull();
      expect(
        await resolveBlockedBranches(
          "o/r",
          {
            present: true,
            blockedBranches: ["renovate/staging-major-vitest-monorepo"],
            unknownSections: [],
          },
          github,
          new Date("2026-10-14T06:16:00Z"),
        ),
      ).toEqual([]);
    });

    describe("renovateMergeWindow counts only merges into the production branch (#1686)", () => {
      const NOW = new Date("2026-10-24T14:00:00Z");
      const pr = (headRef: string, baseRef: string, mergedAt: string | null) => ({
        merged_at: mergedAt,
        head: { ref: headRef },
        base: { ref: baseRef, repo: { default_branch: "main" } },
      });
      const outcomeOf = async (prs: unknown[]) => {
        const { spawn } = fakeSpawn({ stdout: JSON.stringify(prs) });
        return renovateOutcome(
          await makeGitHub({ token: "T", spawn }).renovateMergeWindow("o/r"),
          NOW,
        );
      };

      it("a staging-flow repo whose only recent feature merge went into staging reads as a drought", async () => {
        // The concrete input from #1686: the major landed in `staging`, which
        // serves no visitor; the last update to reach `main` is 30 days old.
        const outcome = await outcomeOf([
          pr("renovate/staging-sveltejs-kit-3.x", "staging", "2026-10-22T10:00:00Z"),
          pr("renovate/main-all-minor-patch", "main", "2026-09-24T10:00:00Z"),
        ]);
        expect(outcome).toMatchObject({
          state: "drought",
          days: 30,
          lastBranch: "renovate/main-all-minor-patch",
        });
      });

      it("staging merges alone are never 'delivering'", async () => {
        const outcome = await outcomeOf([
          pr("renovate/staging-sveltejs-kit-3.x", "staging", "2026-10-22T10:00:00Z"),
        ]);
        expect(outcome.state).toBe("unmeasured");
      });

      it("a feature merge into the default branch still reads delivering", async () => {
        const outcome = await outcomeOf([
          pr("renovate/staging-sveltejs-kit-3.x", "staging", "2026-10-23T10:00:00Z"),
          pr("renovate/main-sveltejs-kit-3.x", "main", "2026-10-22T10:00:00Z"),
        ]);
        expect(outcome).toMatchObject({
          state: "delivering",
          days: 2,
          lastBranch: "renovate/main-sveltejs-kit-3.x",
        });
      });

      it("the production branch is the repo's default branch, whatever its name", async () => {
        const outcome = await outcomeOf([
          {
            merged_at: "2026-10-22T10:00:00Z",
            head: { ref: "renovate/all-minor-patch" },
            base: { ref: "production", repo: { default_branch: "production" } },
          },
        ]);
        expect(outcome.state).toBe("delivering");
      });

      it("a repo whose Renovate merges all go to staging is unmeasured, and says why", async () => {
        // reddoor-website: `baseBranchPatterns: ["staging"]`, unprefixed
        // branch names, promoted to `main` by hand. "Never merged one" would
        // be false; the reason must name where the merges went.
        const outcome = await outcomeOf([
          pr("renovate/all-minor-patch", "staging", "2026-10-19T10:00:00Z"),
          pr("renovate/all-minor-patch", "staging", "2026-10-12T10:00:00Z"),
        ]);
        expect(outcome.state).toBe("unmeasured");
        expect(outcome.state === "unmeasured" && outcome.reason).toMatch(
          /2 feature-update Renovate merges went to a branch other than the default/,
        );
        expect(outcome.state === "unmeasured" && outcome.reason).not.toMatch(/never merged/);
      });

      it("a merge with no readable base or default branch is counted off-default, never thrown", async () => {
        const { spawn } = fakeSpawn({
          stdout: JSON.stringify([
            { merged_at: "2026-10-22T10:00:00Z", head: { ref: "renovate/all-minor-patch" } },
            {
              merged_at: "2026-10-21T10:00:00Z",
              head: { ref: "renovate/all-minor-patch" },
              base: { ref: "main", repo: null },
            },
            {
              merged_at: "2026-10-20T10:00:00Z",
              head: { ref: "renovate/all-minor-patch" },
              base: { ref: "main", repo: {} },
            },
          ]),
        });
        expect(await makeGitHub({ token: "T", spawn }).renovateMergeWindow("o/r")).toEqual({
          merges: [],
          offDefault: [
            { headRef: "renovate/all-minor-patch", mergedAt: "2026-10-22T10:00:00Z" },
            { headRef: "renovate/all-minor-patch", mergedAt: "2026-10-21T10:00:00Z" },
            { headRef: "renovate/all-minor-patch", mergedAt: "2026-10-20T10:00:00Z" },
          ],
          truncated: false,
        });
      });

      it("truncated counts the raw page, so a page full of staging merges still says so", async () => {
        const prs = [
          pr("renovate/main-all-minor-patch", "main", "2026-10-01T10:00:00Z"),
          ...Array.from({ length: 99 }, () =>
            pr("renovate/staging-all-minor-patch", "staging", "2026-10-20T10:00:00Z"),
          ),
        ];
        const { spawn } = fakeSpawn({ stdout: JSON.stringify(prs) });
        const window = await makeGitHub({ token: "T", spawn }).renovateMergeWindow("o/r");
        expect(window.truncated).toBe(true);
        expect(window.offDefault).toHaveLength(99);
        expect(window.merges).toEqual([
          { headRef: "renovate/main-all-minor-patch", mergedAt: "2026-10-01T10:00:00Z" },
        ]);
      });
    });

    it("any other 422 still throws — only the missing-commit answer means no branch", async () => {
      const other = fakeSpawn({ code: 1, stderr: "gh: Validation Failed (HTTP 422)" });
      await expect(
        makeGitHub({ token: "T", spawn: other.spawn }).branchTip("o/r", "x"),
      ).rejects.toThrow(/Validation Failed/);
      const noStatus = fakeSpawn({ code: 1, stderr: "gh: No commit found for SHA: x" });
      await expect(
        makeGitHub({ token: "T", spawn: noStatus.spawn }).branchTip("o/r", "x"),
      ).rejects.toThrow(/No commit found/);
    });
  });
});

describe("makeGitHub repo file reads (the pnpm-pin sweep's inputs)", () => {
  it("repoTextFile decodes the contents API's WRAPPED base64 in full", async () => {
    // GitHub wraps `content` at 60 columns. Decoding without stripping the
    // newlines silently truncates every file past the first line of base64 —
    // which on a workflow file would drop the very step being audited.
    const body = `name: ci\n${"# padding comment line\n".repeat(20)}jobs: {}\n`;
    const wrapped = Buffer.from(body, "utf-8")
      .toString("base64")
      .replace(/(.{60})/g, "$1\n");
    const { spawn, calls } = fakeSpawn({ stdout: `${wrapped}\n` });
    const out = await makeGitHub({ token: "T", spawn }).repoTextFile("o/r", "package.json");
    expect(out).toBe(body);
    expect(calls[0]!.args).toEqual([
      "api",
      "repos/o/r/contents/package.json",
      "--jq",
      '.content // ""',
    ]);
  });

  it("repoTextFile: 404 is the ANSWER null (no package.json = not a node repo); other failures throw", async () => {
    const absent = fakeSpawn({ code: 1, stderr: "gh: Not Found (HTTP 404)" });
    expect(
      await makeGitHub({ token: "T", spawn: absent.spawn }).repoTextFile("o/r", "package.json"),
    ).toBeNull();

    const err = fakeSpawn({ code: 1, stderr: "gh: Internal Server Error (HTTP 500)" });
    await expect(
      makeGitHub({ token: "T", spawn: err.spawn }).repoTextFile("o/r", "package.json"),
    ).rejects.toThrow(/repoTextFile/);
  });

  it("listWorkflowPaths returns yml/yaml files, and [] for a repo with no workflows dir", async () => {
    const listed = fakeSpawn({
      stdout:
        ".github/workflows/ci.yml\n.github/workflows/renovate.yaml\n.github/workflows/README.md\n",
    });
    expect(await makeGitHub({ token: "T", spawn: listed.spawn }).listWorkflowPaths("o/r")).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/renovate.yaml",
    ]);

    const none = fakeSpawn({ code: 1, stderr: "gh: Not Found (HTTP 404)" });
    expect(await makeGitHub({ token: "T", spawn: none.spawn }).listWorkflowPaths("o/r")).toEqual(
      [],
    );
  });
});

describe("makeGitHub.branchRequiredChecks (#892: what requires CI on a Renovate base branch)", () => {
  /** Answers by endpoint, so the two reads are asserted independently. */
  function routed(routes: { branch: Partial<SpawnResult>; rules?: Partial<SpawnResult> }) {
    const calls: string[][] = [];
    const spawn: SpawnFn = async (_cmd, args) => {
      calls.push([...args]);
      const isRules = args.some((a) => a.includes("/rules/branches/"));
      const r = isRules ? (routes.rules ?? {}) : routes.branch;
      return { code: 0, stdout: "", stderr: "", ...r };
    };
    return { spawn, calls };
  }
  const classicOff = JSON.stringify({
    enabled: false,
    required_status_checks: { enforcement_level: "off", contexts: [], checks: [] },
  });

  it("reads GitHub's own per-branch rule evaluation plus classic protection", async () => {
    // Live shape, reddoor-maintenance `main`, 2026-09-29: a ruleset-only branch
    // reports classic protection `enabled: false`, enforcement "off".
    // Rules: every entry carries the ruleset_id that contributes it (#981),
    // printed by the jq below as "<type>\t<ruleset_id>".
    const { spawn, calls } = routed({
      branch: { stdout: `${classicOff}\n` },
      rules: {
        stdout:
          "deletion\t16762724\nnon_fast_forward\t16762724\nrequired_linear_history\t16762724\n" +
          "pull_request\t16762724\nrequired_status_checks\t16762724\n",
      },
    });
    const out = await makeGitHub({ token: "T", spawn }).branchRequiredChecks("o/r", "staging");
    expect(out).toEqual({
      rules: [
        { type: "deletion", ruleset_id: 16762724 },
        { type: "non_fast_forward", ruleset_id: 16762724 },
        { type: "required_linear_history", ruleset_id: 16762724 },
        { type: "pull_request", ruleset_id: 16762724 },
        { type: "required_status_checks", ruleset_id: 16762724 },
      ],
      classicContexts: [],
    });
    expect(calls[0]).toEqual(["api", "repos/o/r/branches/staging", "--jq", ".protection"]);
    expect(calls[1]).toEqual([
      "api",
      "--paginate",
      "repos/o/r/rules/branches/staging?per_page=100",
      "--jq",
      '.[] | "\\(.type)\\t\\(.ruleset_id // "")"',
    ]);
  });

  it("a rule with no ruleset_id is kept WITHOUT one — never dropped, never given a made-up id", async () => {
    const { spawn } = routed({
      branch: { stdout: classicOff },
      rules: {
        stdout:
          "required_status_checks\t\ndeletion\t7\nnon_fast_forward\tnot-a-number\npull_request\t0\nrequired_linear_history\t-3\n",
      },
    });
    const out = await makeGitHub({ token: "T", spawn }).branchRequiredChecks("o/r", "staging");
    expect(out).toEqual({
      rules: [
        { type: "required_status_checks" },
        { type: "deletion", ruleset_id: 7 },
        { type: "non_fast_forward" },
        { type: "pull_request" },
        { type: "required_linear_history" },
      ],
      classicContexts: [],
    });
  });

  it.skipIf(spawnSync("jq", ["--version"]).status !== 0)(
    "the jq's output is exactly what the parser reads (run through real jq on the live shape)",
    async () => {
      const live = JSON.stringify([
        {
          type: "deletion",
          ruleset_source_type: "Repository",
          ruleset_source: "o/r",
          ruleset_id: 16762724,
        },
        {
          type: "required_status_checks",
          ruleset_source_type: "Repository",
          ruleset_source: "o/r",
          ruleset_id: 16762724,
          parameters: { required_status_checks: [{ context: "ci / ci" }] },
        },
        { type: "non_fast_forward" },
      ]);
      const probe = routed({ branch: { stdout: classicOff }, rules: { stdout: "" } });
      await makeGitHub({ token: "T", spawn: probe.spawn }).branchRequiredChecks("o/r", "staging");
      const filter = probe.calls[1]![4]!;
      const printed = spawnSync("jq", ["-r", filter], { input: live, encoding: "utf8" }).stdout;
      const { spawn } = routed({ branch: { stdout: classicOff }, rules: { stdout: printed } });
      expect(
        await makeGitHub({ token: "T", spawn }).branchRequiredChecks("o/r", "staging"),
      ).toEqual({
        rules: [
          { type: "deletion", ruleset_id: 16762724 },
          { type: "required_status_checks", ruleset_id: 16762724 },
          { type: "non_fast_forward" },
        ],
        classicContexts: [],
      });
    },
  );

  it("classic protection's contexts AND checks count, unless enforcement is off", async () => {
    const on = JSON.stringify({
      enabled: true,
      required_status_checks: {
        enforcement_level: "non_admins",
        contexts: ["ci / ci"],
        checks: [{ context: "ci / ci" }, { context: "build" }],
      },
    });
    const gated = routed({ branch: { stdout: on }, rules: { stdout: "" } });
    expect(
      await makeGitHub({ token: "T", spawn: gated.spawn }).branchRequiredChecks("o/r", "staging"),
    ).toEqual({ rules: [], classicContexts: ["ci / ci", "build"] });

    // "off" is not a gate even when contexts are listed: enforcement is what
    // binds, and a list with nothing enforcing it blocks no merge.
    const offWithContexts = JSON.stringify({
      enabled: true,
      required_status_checks: {
        enforcement_level: "off",
        contexts: ["ci / ci"],
        checks: [{ context: "ci / ci" }],
      },
    });
    const listedButOff = routed({ branch: { stdout: offWithContexts }, rules: { stdout: "" } });
    expect(
      await makeGitHub({ token: "T", spawn: listedButOff.spawn }).branchRequiredChecks(
        "o/r",
        "staging",
      ),
    ).toEqual({ rules: [], classicContexts: [] });

    const off = routed({ branch: { stdout: classicOff }, rules: { stdout: "deletion\t3\n" } });
    expect(
      await makeGitHub({ token: "T", spawn: off.spawn }).branchRequiredChecks("o/r", "staging"),
    ).toEqual({ rules: [{ type: "deletion", ruleset_id: 3 }], classicContexts: [] });
  });

  it("a 404 branch is the ANSWER null; a refusal or a missing protection object THROWS", async () => {
    const gone = routed({ branch: { code: 1, stderr: "gh: Branch not found (HTTP 404)" } });
    expect(
      await makeGitHub({ token: "T", spawn: gone.spawn }).branchRequiredChecks("o/r", "staging"),
    ).toBeNull();
    expect(gone.calls).toHaveLength(1);

    const refused = routed({ branch: { code: 1, stderr: "gh: Forbidden (HTTP 403)" } });
    await expect(
      makeGitHub({ token: "T", spawn: refused.spawn }).branchRequiredChecks("o/r", "staging"),
    ).rejects.toThrow(/HTTP 403/);

    // `protection` absent is not "no protection" — it is a response this reader
    // does not understand, and must not arrive downstream as zero checks.
    const hidden = routed({ branch: { stdout: "null\n" } });
    await expect(
      makeGitHub({ token: "T", spawn: hidden.spawn }).branchRequiredChecks("o/r", "staging"),
    ).rejects.toThrow(/protection/);

    const rulesRefused = routed({
      branch: { stdout: classicOff },
      rules: { code: 1, stderr: "gh: Forbidden (HTTP 403)" },
    });
    await expect(
      makeGitHub({ token: "T", spawn: rulesRefused.spawn }).branchRequiredChecks("o/r", "staging"),
    ).rejects.toThrow(/HTTP 403/);
  });
});

// --- protectBranch carries the branch's existing protection forward (#998). ---
// The PUT replaces the whole protection object, so every field it omits or
// nulls is a field it removes. Shapes are GitHub REST's: "Get branch
// protection" (GET) and "Update branch protection" (PUT) on
// /repos/{owner}/{repo}/branches/{branch}/protection. The two differ: the GET
// wraps booleans as {enabled}, and lists users/teams/apps as objects where
// the PUT takes logins and slugs.
describe("protectBranch carries forward existing protection (#998)", () => {
  /** A fake gh: the GET answers `get`; the PUT's --input body is captured. */
  function protectionSpawn(get: Partial<SpawnResult>): {
    spawn: SpawnFn;
    puts: unknown[];
    calls: string[][];
  } {
    const puts: unknown[] = [];
    const calls: string[][] = [];
    const spawn: SpawnFn = async (_cmd, args) => {
      calls.push([...args]);
      if (args.includes("PUT")) {
        const i = args.indexOf("--input");
        puts.push(JSON.parse(readFileSync(args[i + 1]!, "utf-8")));
        return { code: 0, stdout: "{}", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "", ...get };
    };
    return { spawn, puts, calls };
  }

  const API = "https://api.github.com/repos/o/r/branches/main/protection";
  /** A GET response for an org repo with every PUT-settable field set. */
  const FULL_GET = {
    url: API,
    required_status_checks: {
      url: `${API}/required_status_checks`,
      strict: false,
      contexts: ["build", "lint"],
      contexts_url: `${API}/required_status_checks/contexts`,
      checks: [
        { context: "build", app_id: 15368 },
        { context: "lint", app_id: null },
      ],
    },
    enforce_admins: { url: `${API}/enforce_admins`, enabled: false },
    required_pull_request_reviews: {
      url: `${API}/required_pull_request_reviews`,
      dismissal_restrictions: {
        url: `${API}/dismissal_restrictions`,
        users_url: `${API}/dismissal_restrictions/users`,
        teams_url: `${API}/dismissal_restrictions/teams`,
        users: [{ login: "octocat", id: 1, type: "User" }],
        teams: [{ slug: "justice-league", id: 1, name: "Justice League" }],
        apps: [{ slug: "octoapp", id: 1, name: "Octocat App" }],
      },
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 2,
      require_last_push_approval: true,
      bypass_pull_request_allowances: {
        users: [{ login: "hubot", id: 2 }],
        teams: [{ slug: "ops", id: 2 }],
        apps: [{ slug: "renovate", id: 2 }],
      },
    },
    restrictions: {
      url: `${API}/restrictions`,
      users_url: `${API}/restrictions/users`,
      teams_url: `${API}/restrictions/teams`,
      apps_url: `${API}/restrictions/apps`,
      users: [{ login: "octocat", id: 1 }],
      teams: [{ slug: "justice-league", id: 1 }],
      apps: [{ slug: "octoapp", id: 1 }],
    },
    required_linear_history: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    block_creations: { enabled: true },
    required_conversation_resolution: { enabled: true },
    lock_branch: { enabled: false },
    allow_fork_syncing: { enabled: true },
    required_signatures: { url: `${API}/required_signatures`, enabled: true },
  };

  it("reads the protection before it writes, on the same branch", async () => {
    const { spawn, calls } = protectionSpawn({ stdout: JSON.stringify(FULL_GET) });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]);
    expect(calls[0]).toEqual(["api", "repos/o/r/branches/main/protection"]);
    expect(calls[1]!.slice(0, 4)).toEqual([
      "api",
      "-X",
      "PUT",
      "repos/o/r/branches/main/protection",
    ]);
    expect(calls).toHaveLength(2);
  });

  it("keeps reviews, restrictions, enforce_admins and every flag; adds only the new check", async () => {
    const { spawn, puts } = protectionSpawn({ stdout: JSON.stringify(FULL_GET) });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", [
      "build",
      "lint",
      "ci / ci",
    ]);
    expect(puts).toEqual([
      {
        required_status_checks: {
          strict: false,
          checks: [
            { context: "build", app_id: 15368 },
            // GET's null app_id means "any app"; the PUT spells that -1.
            // Omitting it would let GitHub pin the check to whichever app
            // last reported it.
            { context: "lint", app_id: -1 },
            { context: "ci / ci" },
          ],
        },
        enforce_admins: false,
        required_pull_request_reviews: {
          dismissal_restrictions: {
            users: ["octocat"],
            teams: ["justice-league"],
            apps: ["octoapp"],
          },
          dismiss_stale_reviews: true,
          require_code_owner_reviews: true,
          required_approving_review_count: 2,
          require_last_push_approval: true,
          bypass_pull_request_allowances: {
            users: ["hubot"],
            teams: ["ops"],
            apps: ["renovate"],
          },
        },
        restrictions: { users: ["octocat"], teams: ["justice-league"], apps: ["octoapp"] },
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false,
        block_creations: true,
        required_conversation_resolution: true,
        lock_branch: false,
        allow_fork_syncing: true,
      },
    ]);
  });

  it("never drops an existing check, even when the caller names only the new one", async () => {
    const { spawn, puts } = protectionSpawn({ stdout: JSON.stringify(FULL_GET) });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]);
    const body = puts[0] as { required_status_checks: { checks: Array<{ context: string }> } };
    expect(body.required_status_checks.checks.map((c) => c.context)).toEqual([
      "build",
      "lint",
      "ci / ci",
    ]);
  });

  it("carries enforce_admins: true forward as true", async () => {
    const get = { ...FULL_GET, enforce_admins: { url: `${API}/enforce_admins`, enabled: true } };
    const { spawn, puts } = protectionSpawn({ stdout: JSON.stringify(get) });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]);
    expect((puts[0] as { enforce_admins: unknown }).enforce_admins).toBe(true);
  });

  it("protection with required_status_checks: null keeps the rest and gains the check", async () => {
    // A user-owned repo: no restrictions, no dismissal restrictions (both are
    // org-only), reviews required, status checks absent.
    const get = {
      url: API,
      required_status_checks: null,
      enforce_admins: { url: `${API}/enforce_admins`, enabled: false },
      required_pull_request_reviews: {
        url: `${API}/required_pull_request_reviews`,
        dismiss_stale_reviews: false,
        require_code_owner_reviews: false,
        required_approving_review_count: 1,
        require_last_push_approval: false,
      },
      required_linear_history: { enabled: false },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      block_creations: { enabled: false },
      required_conversation_resolution: { enabled: false },
      lock_branch: { enabled: false },
      allow_fork_syncing: { enabled: false },
    };
    const { spawn, puts } = protectionSpawn({ stdout: JSON.stringify(get) });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]);
    expect(puts).toEqual([
      {
        required_status_checks: { strict: true, checks: [{ context: "ci / ci" }] },
        enforce_admins: false,
        required_pull_request_reviews: {
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
          required_approving_review_count: 1,
          require_last_push_approval: false,
        },
        restrictions: null,
        required_linear_history: false,
        allow_force_pushes: false,
        allow_deletions: false,
        block_creations: false,
        required_conversation_resolution: false,
        lock_branch: false,
        allow_fork_syncing: false,
      },
    ]);
  });

  it("404 Branch not protected: a fresh protection, with nothing to carry forward", async () => {
    const { spawn, puts } = protectionSpawn({
      code: 1,
      stderr: "gh: Branch not protected (HTTP 404)",
    });
    await makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]);
    expect(puts).toEqual([
      {
        required_status_checks: { strict: true, checks: [{ context: "ci / ci" }] },
        enforce_admins: true,
        required_pull_request_reviews: null,
        restrictions: null,
      },
    ]);
  });

  // #1447: "restrict who can dismiss reviews" turned on with nobody listed
  // comes back from the GET as a dismissal_restrictions object whose users,
  // teams and apps are all empty. The PUT docs say "Pass an empty
  // dismissal_restrictions object to disable", so sending those empty lists
  // back may turn the restriction off. Unverified either way, so refuse.
  it("dismissal restriction on with nobody listed: throws, names the case, never PUTs (#1447)", async () => {
    const get = {
      ...FULL_GET,
      required_pull_request_reviews: {
        ...FULL_GET.required_pull_request_reviews,
        dismissal_restrictions: {
          url: `${API}/dismissal_restrictions`,
          users_url: `${API}/dismissal_restrictions/users`,
          teams_url: `${API}/dismissal_restrictions/teams`,
          users: [],
          teams: [],
          apps: [],
        },
      },
    };
    const { spawn, puts } = protectionSpawn({ stdout: JSON.stringify(get) });
    await expect(
      makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]),
    ).rejects.toThrow(/dismiss.*no user, team or app.*by hand/is);
    await expect(
      makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]),
    ).rejects.toBeInstanceOf(ProtectionRefusedError);
    expect(puts).toEqual([]);
  });

  it("dismissal restriction with only an app listed is sent as today (#1447)", async () => {
    const get = {
      ...FULL_GET,
      required_pull_request_reviews: {
        ...FULL_GET.required_pull_request_reviews,
        dismissal_restrictions: { users: [], teams: [], apps: [{ slug: "octoapp", id: 1 }] },
      },
    };
    expect(
      (protectionPutBody(get, ["ci / ci"]).required_pull_request_reviews as Record<string, unknown>)
        .dismissal_restrictions,
    ).toEqual({ users: [], teams: [], apps: ["octoapp"] });
  });

  // #1448: a check carried from a contexts-only GET, or newly appended, goes
  // out with no app_id, so GitHub pins it to the app that last reported it.
  // Kept on purpose (stricter than "any app"); only an existing check whose
  // GET app_id is null keeps "any app" as -1.
  it("contexts-only and appended checks go out without app_id; app_id: null goes out as -1 (#1448)", () => {
    const body = protectionPutBody(
      {
        required_status_checks: {
          strict: true,
          checks: [{ context: "lint", app_id: null }],
          contexts: ["lint", "build"],
        },
      },
      ["ci / ci"],
    );
    expect(body.required_status_checks).toEqual({
      strict: true,
      checks: [{ context: "lint", app_id: -1 }, { context: "build" }, { context: "ci / ci" }],
    });
    const contextsOnly = protectionPutBody(
      { required_status_checks: { strict: true, contexts: ["build"] } },
      ["ci / ci"],
    );
    expect(contextsOnly.required_status_checks).toEqual({
      strict: true,
      checks: [{ context: "build" }, { context: "ci / ci" }],
    });
  });

  it.each([
    ["a refusal", { code: 1, stderr: "gh: Resource not accessible by integration (HTTP 403)" }],
    ["a server error", { code: 1, stderr: "gh: Server Error (HTTP 500)" }],
    ["a missing branch", { code: 1, stderr: "gh: Branch not found (HTTP 404)" }],
    ["a body that is not JSON", { code: 0, stdout: "<html>" }],
    ["a body that is not an object", { code: 0, stdout: "[]" }],
  ])("a failed read (%s) throws and never PUTs", async (_, get) => {
    const { spawn, puts } = protectionSpawn(get);
    await expect(
      makeGitHub({ token: "T", spawn }).protectBranch("o/r", "main", ["ci / ci"]),
    ).rejects.toThrow(/protectBranch\(o\/r:main\)/);
    expect(puts).toEqual([]);
  });
});
