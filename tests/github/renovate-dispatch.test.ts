import { describe, it, expect } from "vitest";
import {
  selectRenovateTargets,
  dispatchRenovateAcross,
  formatRenovateDispatchSummary,
  hasHealthyRenovatePr,
  RENOVATE_WORKFLOW_FILE,
  computeAutoFixAttemptUpdates,
  applyAutoFixAttemptUpdates,
  formatAutoFixAttemptsSummary,
} from "../../src/github/renovate-dispatch.js";
import type { PullRequestSummary } from "../../src/github/gh.js";
import type { RenovateDispatchResult } from "../../src/github/renovate-dispatch.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function pr(over: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    number: 1,
    title: "chore(deps): bump x",
    url: "https://github.com/o/r/pull/1",
    headRef: "renovate/x",
    ciState: "passing",
    mergeable: "MERGEABLE",
    ...over,
  };
}

describe("hasHealthyRenovatePr", () => {
  it("is true when a non-conflicting Renovate PR is open (remediation in flight → skip dispatch)", () => {
    expect(hasHealthyRenovatePr([pr({ mergeable: "MERGEABLE" })])).toBe(true);
    // UNKNOWN (GitHub still computing) counts as healthy — don't churn on uncertainty
    expect(hasHealthyRenovatePr([pr({ mergeable: "UNKNOWN" })])).toBe(true);
  });

  it("is false when the only open Renovate PR is CONFLICTING/stuck (→ re-dispatch to rebase)", () => {
    expect(hasHealthyRenovatePr([pr({ mergeable: "CONFLICTING" })])).toBe(false);
  });

  it("ignores non-Renovate PRs", () => {
    expect(hasHealthyRenovatePr([pr({ headRef: "feature/login", mergeable: "MERGEABLE" })])).toBe(
      false,
    );
    // a healthy Renovate PR alongside a non-Renovate one still counts
    expect(
      hasHealthyRenovatePr([
        pr({ headRef: "feature/x", mergeable: "MERGEABLE" }),
        pr({ headRef: "renovate/y", mergeable: "MERGEABLE" }),
      ]),
    ).toBe(true);
  });

  it("is false for no open PRs at all", () => {
    expect(hasHealthyRenovatePr([])).toBe(false);
  });
});

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
      hasHealthyOpenRenovatePr: async () => false,
      defaultBranch: async (repo) => (repo === "reddoorla/b" ? "master" : "main"),
      dispatch: async (repo, workflow, ref) => {
        calls.push({ repo, workflow, ref });
      },
    });
    expect(result.dispatched).toEqual(["reddoorla/a", "reddoorla/b"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(calls).toEqual([
      { repo: "reddoorla/a", workflow: RENOVATE_WORKFLOW_FILE, ref: "main" },
      { repo: "reddoorla/b", workflow: RENOVATE_WORKFLOW_FILE, ref: "master" },
    ]);
  });

  it("skips a repo with a healthy open Renovate PR (remediation in flight)", async () => {
    const calls: string[] = [];
    const result = await dispatchRenovateAcross(targets, {
      hasHealthyOpenRenovatePr: async (repo) => repo === "reddoorla/a",
      defaultBranch: async () => "main",
      dispatch: async (repo) => {
        calls.push(repo);
      },
    });
    expect(result.skipped).toEqual(["reddoorla/a"]);
    expect(result.dispatched).toEqual(["reddoorla/b"]);
    expect(result.failed).toEqual([]);
    expect(calls).toEqual(["reddoorla/b"]); // the skipped repo is never dispatched
  });

  it("records a failed dispatch without aborting the rest", async () => {
    const result = await dispatchRenovateAcross(targets, {
      hasHealthyOpenRenovatePr: async () => false,
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
      hasHealthyOpenRenovatePr: async () => false,
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

  it("records a failed open-PR probe as a failure (never dispatches on a bad probe)", async () => {
    const result = await dispatchRenovateAcross([targets[0]!], {
      hasHealthyOpenRenovatePr: async () => {
        throw new Error("502: PR query failed");
      },
      defaultBranch: async () => "main",
      dispatch: async () => {
        throw new Error("should not dispatch when the PR probe failed");
      },
    });
    expect(result.dispatched).toEqual([]);
    expect(result.failed).toEqual([{ repo: "reddoorla/a", error: "502: PR query failed" }]);
  });
});

describe("computeAutoFixAttemptUpdates", () => {
  const result = (over: Partial<RenovateDispatchResult> = {}): RenovateDispatchResult => ({
    dispatched: [],
    skipped: [],
    failed: [],
    ...over,
  });

  it("increments a dispatched vuln site (null counter reads as 0 → 1)", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsHigh: 2,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/a"] }))).toEqual([
      { id: "rA", attempts: 1 },
    ]);
  });

  it("increments from the existing counter value", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsCritical: 1,
        securityAutoFixAttempts: 2,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/a"] }))).toEqual([
      { id: "rA", attempts: 3 },
    ]);
  });

  it("resets to 0 when a previously-attempted site now has zero vulns", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityAutoFixAttempts: 4,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result())).toEqual([{ id: "rA", attempts: 0 }]);
  });

  it("leaves a skipped vuln site (healthy PR in flight) unchanged — no update emitted", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsHigh: 2,
        securityAutoFixAttempts: 1,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ skipped: ["reddoorla/a"] }))).toEqual([]);
  });

  it("leaves a failed-dispatch vuln site unchanged", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsHigh: 2,
        securityAutoFixAttempts: 1,
      }),
    ];
    expect(
      computeAutoFixAttemptUpdates(
        sites,
        result({ failed: [{ repo: "reddoorla/a", error: "x" }] }),
      ),
    ).toEqual([]);
  });

  it("emits no update when a clean site already sits at 0 (write-minimal)", () => {
    const sites = [
      makeWebsiteRow({
        id: "rA",
        status: "maintenance",
        gitRepo: "reddoorla/a",
        securityVulnsHigh: 0,
        securityAutoFixAttempts: 0,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result())).toEqual([]);
  });

  it("excludes inactive and repo-less sites", () => {
    const sites = [
      makeWebsiteRow({
        id: "rIn",
        status: null,
        gitRepo: "reddoorla/x",
        securityVulnsHigh: 5,
        securityAutoFixAttempts: 2,
      }),
      makeWebsiteRow({
        id: "rNo",
        status: "maintenance",
        gitRepo: null,
        securityVulnsHigh: 5,
        securityAutoFixAttempts: 2,
      }),
    ];
    expect(computeAutoFixAttemptUpdates(sites, result({ dispatched: ["reddoorla/x"] }))).toEqual(
      [],
    );
  });
});

describe("applyAutoFixAttemptUpdates", () => {
  it("writes each update and counts successes; never throws on a writer error", async () => {
    const written: Array<{ id: string; attempts: number }> = [];
    const r = await applyAutoFixAttemptUpdates(
      [
        { id: "rA", attempts: 1 },
        { id: "rB", attempts: 0 },
        { id: "rC", attempts: 3 },
      ],
      async (id, attempts) => {
        if (id === "rB") throw new Error("field not found"); // e.g. column not yet created
        written.push({ id, attempts });
      },
    );
    expect(r).toEqual({ written: 2, failed: 1 });
    expect(written).toEqual([
      { id: "rA", attempts: 1 },
      { id: "rC", attempts: 3 },
    ]);
  });

  it("is a no-op for an empty update list", async () => {
    let calls = 0;
    const r = await applyAutoFixAttemptUpdates([], async () => {
      calls++;
    });
    expect(r).toEqual({ written: 0, failed: 0 });
    expect(calls).toBe(0);
  });
});

describe("formatAutoFixAttemptsSummary", () => {
  it("emits a machine-readable counts line", () => {
    expect(formatAutoFixAttemptsSummary({ written: 2, failed: 1 })).toBe(
      "AUTO_FIX_ATTEMPTS_SUMMARY written=2 failed=1",
    );
  });
});

describe("formatRenovateDispatchSummary", () => {
  it("emits a machine-readable counts line for the workflow to gate on", () => {
    expect(
      formatRenovateDispatchSummary({
        dispatched: ["reddoorla/a", "reddoorla/b"],
        skipped: [],
        failed: [],
      }),
    ).toBe("RENOVATE_DISPATCH_SUMMARY dispatched=2 skipped=0 failed=0");
    expect(
      formatRenovateDispatchSummary({
        dispatched: ["reddoorla/a"],
        skipped: ["reddoorla/c"],
        failed: [{ repo: "reddoorla/b", error: "boom" }],
      }),
    ).toBe("RENOVATE_DISPATCH_SUMMARY dispatched=1 skipped=1 failed=1");
  });
});
