import { describe, it, expect, afterEach, vi } from "vitest";
import {
  renovateFindingsToAttention,
  buildRenovateProbe,
} from "../../src/alerts/digest-collectors.js";
import type { RenovateFailuresResult } from "../../src/alerts/renovate.js";
import type { PullRequestSummary } from "../../src/github/gh.js";

function pr(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 7,
    title: "chore(deps): bump vite to 7.1.0",
    url: "https://github.com/reddoorla/alpha/pull/7",
    headRef: "renovate/npm-vite",
    ciState: "failing",
    ...over,
  };
}

describe("renovateFindingsToAttention", () => {
  it("returns [] for an empty result (no findings, nothing skipped)", () => {
    expect(renovateFindingsToAttention({ findings: [], skipped: [] })).toEqual([]);
  });

  it("maps each finding to one warning AttentionItem keyed by repo#number", () => {
    const result: RenovateFailuresResult = {
      findings: [
        { site: "Alpha Co", repo: "reddoorla/alpha", pr: pr({ number: 7, url: "u7" }) },
        {
          site: "Beta Co",
          repo: "reddoorla/beta",
          pr: pr({ number: 12, title: "fix(deps): bump zod", url: "u12" }),
        },
      ],
      skipped: [],
    };
    const items = renovateFindingsToAttention(result);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      key: "renovate:reddoorla/alpha#7",
      kind: "renovate",
      siteName: "Alpha Co",
      title: "Renovate update failing CI: chore(deps): bump vite to 7.1.0",
      url: "u7",
      severity: "warning",
      metric: 1,
    });
    expect(items[1]).toMatchObject({
      key: "renovate:reddoorla/beta#12",
      siteName: "Beta Co",
      title: "Renovate update failing CI: fix(deps): bump zod",
      url: "u12",
    });
  });

  it("appends ONE 'couldn't check' note item when skipped is non-empty, metric = skipped count", () => {
    const result: RenovateFailuresResult = {
      findings: [{ site: "Alpha Co", repo: "reddoorla/alpha", pr: pr({ number: 7 }) }],
      skipped: ["reddoorla/x", "reddoorla/y"],
    };
    const items = renovateFindingsToAttention(result);
    expect(items).toHaveLength(2); // one finding + one note
    const note = items.find((i) => i.key === "renovate:skipped")!;
    expect(note).toEqual({
      key: "renovate:skipped",
      kind: "renovate",
      siteName: "Fleet checks",
      title: "Couldn't check 2 repo(s) for failing Renovate PRs",
      severity: "warning",
      metric: 2,
    });
  });

  it("emits the skipped note even when there are no findings", () => {
    const items = renovateFindingsToAttention({ findings: [], skipped: ["reddoorla/x"] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "renovate:skipped",
      title: "Couldn't check 1 repo(s) for failing Renovate PRs",
      metric: 1,
    });
  });
});

describe("buildRenovateProbe", () => {
  const saved = {
    RENOVATE_TOKEN: process.env.RENOVATE_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
  };

  afterEach(() => {
    if (saved.RENOVATE_TOKEN === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = saved.RENOVATE_TOKEN;
    if (saved.GH_TOKEN === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = saved.GH_TOKEN;
    vi.restoreAllMocks();
  });

  it("returns undefined when neither RENOVATE_TOKEN nor GH_TOKEN is set (no-token run skips)", () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    expect(buildRenovateProbe()).toBeUndefined();
  });

  it("returns undefined when both tokens are blank/whitespace", () => {
    process.env.RENOVATE_TOKEN = "  ";
    process.env.GH_TOKEN = "";
    expect(buildRenovateProbe()).toBeUndefined();
  });

  it("returns a probe function when RENOVATE_TOKEN is set", () => {
    process.env.RENOVATE_TOKEN = "ghp_renovate";
    delete process.env.GH_TOKEN;
    expect(typeof buildRenovateProbe()).toBe("function");
  });

  it("falls back to GH_TOKEN when RENOVATE_TOKEN is unset", () => {
    delete process.env.RENOVATE_TOKEN;
    process.env.GH_TOKEN = "ghp_broad";
    expect(typeof buildRenovateProbe()).toBe("function");
  });
});
