import { describe, it, expect } from "vitest";
import { makeGitHub } from "../../src/github/gh.js";

function fakeSpawn(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: "" });
}

const SINCE = "2026-06-20T00:00:00.000Z";

const PRS = JSON.stringify([
  {
    number: 14,
    title: "chore(deps): update dependency vite to v7.3.5 [security]",
    html_url: "https://github.com/reddoorla/caltex/pull/14",
    merged_at: "2026-06-24T09:00:00.000Z",
    head: { ref: "renovate/vite-7.x" },
  },
  {
    number: 13,
    title: "chore(deps): update dependency old to v1",
    html_url: "https://github.com/reddoorla/caltex/pull/13",
    merged_at: "2026-06-10T09:00:00.000Z", // before SINCE → excluded
    head: { ref: "renovate/old" },
  },
  {
    number: 12,
    title: "fix: a human PR",
    html_url: "https://github.com/reddoorla/caltex/pull/12",
    merged_at: "2026-06-24T09:00:00.000Z",
    head: { ref: "feat/thing" }, // not renovate/* → excluded
  },
  {
    number: 11,
    title: "chore(deps): closed unmerged",
    html_url: "https://github.com/reddoorla/caltex/pull/11",
    merged_at: null, // closed, never merged → excluded
    head: { ref: "renovate/unmerged" },
  },
]);

describe("mergedRenovatePullRequests", () => {
  it("returns only renovate/* PRs merged at/after the watermark", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn(PRS) });
    const merged = await gh.mergedRenovatePullRequests("reddoorla/caltex", SINCE);
    expect(merged).toEqual([
      {
        number: 14,
        title: "chore(deps): update dependency vite to v7.3.5 [security]",
        url: "https://github.com/reddoorla/caltex/pull/14",
        mergedAt: "2026-06-24T09:00:00.000Z",
      },
    ]);
  });

  it("rejects a malformed repo string", async () => {
    const gh = makeGitHub({ token: "t", spawn: fakeSpawn("[]") });
    await expect(gh.mergedRenovatePullRequests("not-a-repo", SINCE)).rejects.toThrow(/owner\/repo/);
  });
});
