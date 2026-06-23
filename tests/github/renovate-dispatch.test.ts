import { describe, it, expect } from "vitest";
import {
  selectRenovateTargets,
  dispatchRenovateAcross,
  formatRenovateDispatchSummary,
  RENOVATE_WORKFLOW_FILE,
} from "../../src/github/renovate-dispatch.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

describe("selectRenovateTargets", () => {
  it("picks active, repo-backed sites with critical OR high vulns", () => {
    const sites = [
      makeWebsiteRow({
        name: "A",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsHigh: 3,
      }),
      makeWebsiteRow({
        name: "B",
        status: "maintenance",
        gitRepo: "reddoorla/b",
        securityVulnsCritical: 1,
        securityVulnsHigh: 0,
      }),
      makeWebsiteRow({
        name: "C",
        status: "launch period",
        gitRepo: "reddoorla/c",
        securityVulnsHigh: 2,
      }),
    ];
    const targets = selectRenovateTargets(sites);
    expect(targets.map((t) => t.repo)).toEqual(["reddoorla/a", "reddoorla/b", "reddoorla/c"]);
    expect(targets[0]).toMatchObject({ repo: "reddoorla/a", siteName: "A", high: 3, critical: 0 });
  });

  it("excludes inactive sites, repo-less sites, and moderate/low-only or zero-vuln sites", () => {
    const sites = [
      // inactive (null status) — excluded even with vulns
      makeWebsiteRow({
        name: "inactive",
        status: null,
        gitRepo: "reddoorla/x",
        securityVulnsHigh: 9,
      }),
      // no repo — can't dispatch
      makeWebsiteRow({
        name: "norepo",
        status: "maintenance",
        gitRepo: null,
        securityVulnsHigh: 5,
      }),
      // blank repo string — also can't dispatch
      makeWebsiteRow({
        name: "blankrepo",
        status: "maintenance",
        gitRepo: "  ",
        securityVulnsHigh: 5,
      }),
      // only moderate/low — not actionable enough to dispatch off-schedule
      makeWebsiteRow({
        name: "modlow",
        status: "maintenance",
        gitRepo: "reddoorla/m",
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityVulnsModerate: 7,
        securityVulnsLow: 4,
      }),
      // clean — nothing to do
      makeWebsiteRow({ name: "clean", status: "maintenance", gitRepo: "reddoorla/clean" }),
    ];
    expect(selectRenovateTargets(sites)).toEqual([]);
  });

  it("treats null vuln counts as zero (no false dispatch)", () => {
    const site = makeWebsiteRow({
      name: "nulls",
      status: "maintenance",
      gitRepo: "reddoorla/n",
      securityVulnsCritical: null,
      securityVulnsHigh: null,
    });
    expect(selectRenovateTargets([site])).toEqual([]);
  });

  it("trims the repo so a padded Airtable value still dispatches cleanly", () => {
    const site = makeWebsiteRow({
      name: "pad",
      status: "maintenance",
      gitRepo: " reddoorla/p ",
      securityVulnsHigh: 1,
    });
    expect(selectRenovateTargets([site])[0]?.repo).toBe("reddoorla/p");
  });
});

describe("dispatchRenovateAcross", () => {
  const targets = [
    { repo: "reddoorla/a", siteName: "A", critical: 0, high: 1 },
    { repo: "reddoorla/b", siteName: "B", critical: 1, high: 0 },
  ];

  it("dispatches renovate.yml on each target's default branch", async () => {
    const calls: Array<{ repo: string; workflow: string; ref: string }> = [];
    const result = await dispatchRenovateAcross(targets, {
      defaultBranch: async (repo) => (repo === "reddoorla/b" ? "master" : "main"),
      dispatch: async (repo, workflow, ref) => {
        calls.push({ repo, workflow, ref });
      },
    });
    expect(result.dispatched).toEqual(["reddoorla/a", "reddoorla/b"]);
    expect(result.failed).toEqual([]);
    expect(calls).toEqual([
      { repo: "reddoorla/a", workflow: RENOVATE_WORKFLOW_FILE, ref: "main" },
      { repo: "reddoorla/b", workflow: RENOVATE_WORKFLOW_FILE, ref: "master" },
    ]);
  });

  it("records a failed dispatch without aborting the rest", async () => {
    const result = await dispatchRenovateAcross(targets, {
      defaultBranch: async () => "main",
      dispatch: async (repo) => {
        if (repo === "reddoorla/a") throw new Error("404: no renovate.yml");
      },
    });
    expect(result.dispatched).toEqual(["reddoorla/b"]);
    expect(result.failed).toEqual([{ repo: "reddoorla/a", error: "404: no renovate.yml" }]);
  });

  it("records a failed default-branch lookup as a failure (never throws)", async () => {
    const result = await dispatchRenovateAcross([targets[0]!], {
      defaultBranch: async () => {
        throw new Error("403: token lacks actions:write");
      },
      dispatch: async () => {},
    });
    expect(result.dispatched).toEqual([]);
    expect(result.failed).toEqual([
      { repo: "reddoorla/a", error: "403: token lacks actions:write" },
    ]);
  });
});

describe("formatRenovateDispatchSummary", () => {
  it("emits a machine-readable counts line for the workflow to gate on", () => {
    expect(
      formatRenovateDispatchSummary({ dispatched: ["reddoorla/a", "reddoorla/b"], failed: [] }),
    ).toBe("RENOVATE_DISPATCH_SUMMARY dispatched=2 failed=0");
    expect(
      formatRenovateDispatchSummary({
        dispatched: ["reddoorla/a"],
        failed: [{ repo: "reddoorla/b", error: "boom" }],
      }),
    ).toBe("RENOVATE_DISPATCH_SUMMARY dispatched=1 failed=1");
  });
});
