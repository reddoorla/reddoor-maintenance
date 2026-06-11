import { describe, it, expect } from "vitest";
import {
  isRenovatePR,
  isFailingRenovatePR,
  collectRenovateFailures,
} from "../../src/alerts/renovate.js";
import type { PullRequestSummary } from "../../src/github/gh.js";
import type { Site } from "../../src/types.js";

function pr(over: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    number: 1,
    title: "chore(deps): bump x",
    url: "https://github.com/o/r/pull/1",
    headRef: "renovate/x",
    ciState: "failing",
    ...over,
  };
}

describe("alerts/renovate classifiers", () => {
  it("isRenovatePR recognizes renovate head branches and rejects others", () => {
    expect(isRenovatePR(pr({ headRef: "renovate/npm-vite-7.x" }))).toBe(true);
    // grouped majors are still slash-prefixed (`renovate/<group-slug>`), not a separate shape
    expect(isRenovatePR(pr({ headRef: "renovate/major-svelte" }))).toBe(true);
    // bare `renovate-` matches a custom non-slash branchPrefix (defensive; see RENOVATE_HEAD_PREFIXES)
    expect(isRenovatePR(pr({ headRef: "renovate-npm-vite" }))).toBe(true);
    expect(isRenovatePR(pr({ headRef: "maint/self-updating-abc" }))).toBe(false);
    expect(isRenovatePR(pr({ headRef: "feature/login" }))).toBe(false);
  });

  it("isFailingRenovatePR is true only for a renovate PR whose CI is failing", () => {
    expect(isFailingRenovatePR(pr({ headRef: "renovate/x", ciState: "failing" }))).toBe(true);
    expect(isFailingRenovatePR(pr({ headRef: "renovate/x", ciState: "passing" }))).toBe(false);
    expect(isFailingRenovatePR(pr({ headRef: "renovate/x", ciState: "pending" }))).toBe(false);
    expect(isFailingRenovatePR(pr({ headRef: "renovate/x", ciState: "none" }))).toBe(false);
    expect(isFailingRenovatePR(pr({ headRef: "feature/x", ciState: "failing" }))).toBe(false);
  });
});

describe("alerts/renovate collectRenovateFailures", () => {
  const sites: Site[] = [
    {
      path: "/w/alpha",
      name: "alpha",
      gitRepo: "reddoorla/alpha",
      meta: { displayName: "Alpha Co" },
    },
    { path: "/w/beta", name: "beta", gitRepo: "reddoorla/beta", meta: { displayName: "Beta Co" } },
    { path: "/w/nolocal", name: "nogit" }, // no gitRepo -> skipped, not an error
  ];

  it("returns one finding per failing renovate PR, tagged with site display name + repo", async () => {
    const byRepo: Record<string, PullRequestSummary[]> = {
      "reddoorla/alpha": [
        pr({ number: 11, headRef: "renovate/npm-vite", ciState: "failing", url: "u11" }),
        pr({ number: 12, headRef: "renovate/npm-zod", ciState: "passing", url: "u12" }),
      ],
      "reddoorla/beta": [pr({ number: 21, headRef: "feature/x", ciState: "failing", url: "u21" })],
    };
    const probe = async (repo: string) => byRepo[repo] ?? [];

    const { findings, skipped } = await collectRenovateFailures(sites, probe);

    expect(skipped).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      site: "Alpha Co",
      repo: "reddoorla/alpha",
      pr: { number: 11, url: "u11" },
    });
  });

  it("skips sites with no gitRepo without treating them as errors", async () => {
    const probe = async () => [] as PullRequestSummary[];
    const { findings, skipped } = await collectRenovateFailures(sites, probe);
    expect(findings).toEqual([]);
    expect(skipped).toEqual([]); // the no-gitRepo site is silently out of scope, not skipped-with-error
  });

  it("records a repo whose probe throws in `skipped` and keeps sweeping the rest (no silent drop)", async () => {
    const probe = async (repo: string) => {
      if (repo === "reddoorla/alpha") throw new Error("gh api 502");
      return [pr({ number: 21, headRef: "renovate/x", ciState: "failing", url: "u21" })];
    };
    const { findings, skipped } = await collectRenovateFailures(sites, probe);
    expect(skipped).toEqual(["reddoorla/alpha"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ repo: "reddoorla/beta", pr: { number: 21 } });
  });

  it("collects every failing renovate PR when a repo has more than one", async () => {
    const oneSite: Site[] = [
      {
        path: "/w/alpha",
        name: "alpha",
        gitRepo: "reddoorla/alpha",
        meta: { displayName: "Alpha Co" },
      },
    ];
    const probe = async () => [
      pr({ number: 11, headRef: "renovate/npm-vite", ciState: "failing", url: "u11" }),
      pr({ number: 13, headRef: "renovate/npm-svelte", ciState: "failing", url: "u13" }),
      pr({ number: 12, headRef: "renovate/npm-zod", ciState: "passing", url: "u12" }),
    ];
    const { findings } = await collectRenovateFailures(oneSite, probe);
    expect(findings.map((f) => f.pr.number).sort()).toEqual([11, 13]);
  });

  it("labels a finding by site name when displayName is missing/empty, else 'unknown'", async () => {
    const probe = async () => [pr({ number: 9, headRef: "renovate/x", ciState: "failing" })];
    const missing = await collectRenovateFailures(
      [{ path: "/w/x", name: "slug-name", gitRepo: "reddoorla/x", meta: {} }],
      probe,
    );
    expect(missing.findings[0]!.site).toBe("slug-name");

    const empty = await collectRenovateFailures(
      [{ path: "/w/x", name: "", gitRepo: "reddoorla/x", meta: { displayName: "" } }],
      probe,
    );
    expect(empty.findings[0]!.site).toBe("unknown");
  });
});
