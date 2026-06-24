import { describe, it, expect } from "vitest";
import { collectGitHubSignals } from "../../src/audits/github-signals.js";
import type { Site } from "../../src/types.js";
import type { PullRequestSummary } from "../../src/github/gh.js";

function site(over: Partial<Site> = {}): Site {
  return { path: "", name: "caltex", meta: {}, gitRepo: "reddoorla/caltex", ...over } as Site;
}
function pr(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    title: "chore(deps): x",
    url: "https://x",
    headRef: "renovate/x",
    ciState: "failing",
    mergeable: "MERGEABLE",
    ...over,
  };
}

describe("collectGitHubSignals", () => {
  it("counts failing Renovate PRs and records CI state + last commit per site", async () => {
    const rows = await collectGitHubSignals([site()], {
      openPullRequests: async () => [
        pr(),
        pr({ number: 2, headRef: "renovate/y" }),
        pr({ number: 3, headRef: "feature", ciState: "failing" }),
      ],
      defaultBranchStatus: async () => ({
        ciState: "passing",
        lastCommitAt: "2026-06-01T00:00:00Z",
      }),
    });
    expect(rows).toEqual([
      {
        site: "caltex",
        repo: "reddoorla/caltex",
        renovateFailingCis: 2,
        ciState: "passing",
        lastCommitAt: "2026-06-01T00:00:00Z",
      },
    ]);
  });

  it("skips sites without a gitRepo", async () => {
    const rows = await collectGitHubSignals([site({ gitRepo: "" })], {
      openPullRequests: async () => [],
      defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: null }),
    });
    expect(rows).toEqual([]);
  });

  it("records a repo whose probe throws in `skipped`, not in rows", async () => {
    const skipped: string[] = [];
    const rows = await collectGitHubSignals(
      [site({ name: "a", gitRepo: "o/a" }), site({ name: "b", gitRepo: "o/b" })],
      {
        openPullRequests: async (r) => {
          if (r === "o/a") throw new Error("boom");
          return [];
        },
        defaultBranchStatus: async () => ({ ciState: "passing", lastCommitAt: null }),
      },
      (s) => skipped.push(s.repo),
    );
    // "o/a" failed its probe → only "b" produces a row; "o/a" is reported skipped.
    expect(rows.map((r) => r.repo)).toEqual(["o/b"]);
    expect(skipped).toEqual(["o/a"]);
  });
});
