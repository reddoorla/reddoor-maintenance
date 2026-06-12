import { describe, it, expect } from "vitest";
import { isRenovatePR, isFailingRenovatePR } from "../../src/alerts/renovate.js";
import type { PullRequestSummary } from "../../src/github/gh.js";

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
