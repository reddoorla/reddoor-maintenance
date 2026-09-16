import { describe, it, expect, afterEach } from "vitest";
import {
  protectionAuditExitCode,
  runProtectionAuditCommand,
  type ProtectionAuditDeps,
} from "../../src/cli/commands/protection-audit.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";

const SEC_ON = { secretScanning: "enabled", pushProtection: "enabled" };
const PUBLIC_CLEAN = { visibility: "public", archived: false, ...SEC_ON };
// A run minutes ago relative to the command's real `new Date()` default.
const FRESH = new Date().toISOString();

describe("protectionAuditExitCode", () => {
  it("exits 1 on ANY gap — a single unprotected public repo is a hole, not a flake", () => {
    expect(protectionAuditExitCode(1)).toBe(1);
    expect(protectionAuditExitCode(5)).toBe(1);
  });

  it("exits 0 on a clean sweep", () => {
    expect(protectionAuditExitCode(0)).toBe(0);
  });
});

describe("runProtectionAuditCommand", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("rejects a missing --org with exit 2", async () => {
    const r = await runProtectionAuditCommand({});
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runProtectionAuditCommand({ org: "reddoorla" });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
  });

  it("full sweep: per-repo lines + machine summary + exit 1 on a gap", async () => {
    const deps: ProtectionAuditDeps = {
      listOrgRepos: async () => [
        { name: "espada", ...PUBLIC_CLEAN },
        { name: "naked", ...PUBLIC_CLEAN },
        { name: "the-tower", visibility: "private", archived: false, ...SEC_ON },
      ],
      listRepoRulesets: async (repo) =>
        repo === "reddoorla/espada" ? [{ id: 1, name: FLEET_RULESET_NAME }] : [],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({
        present: true,
        blockedBranches: [],
        unknownSections: [],
      }),
      branchTip: async () => null,
      openSecretAlerts: async () => 0,
      renovateMergeWindow: async () => ({ merges: [], truncated: false }),
      repoTextFile: async () => null,
      listWorkflowPaths: async () => [],
    };
    const r = await runProtectionAuditCommand({ org: "reddoorla" }, deps);
    expect(r.code).toBe(1);
    expect(r.output).toContain("COVERED reddoorla/espada");
    // Anchored at column 0: fleet-security.yml extracts the tracking-issue
    // body with `grep -E "^GAP"` — any prefix (indentation, timestamp, tag)
    // would silently degrade the issue to its "see run output" fallback.
    expect(r.output).toMatch(/^GAP {5}reddoorla\/naked — no repo rulesets at all$/m);
    expect(r.output).toContain("SKIPPED reddoorla/the-tower");
    // The machine line the nightly workflow's tracking issue gates on.
    expect(r.output).toContain("PROTECTION_AUDIT gaps=1 covered=1 skipped=1 total=3");
  });

  it("clean fleet: exit 0 with gaps=0 in the summary", async () => {
    const deps: ProtectionAuditDeps = {
      listOrgRepos: async () => [{ name: "espada", ...PUBLIC_CLEAN }],
      listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({
        present: true,
        blockedBranches: [],
        unknownSections: [],
      }),
      branchTip: async () => null,
      openSecretAlerts: async () => 0,
      renovateMergeWindow: async () => ({ merges: [], truncated: false }),
      repoTextFile: async () => null,
      listWorkflowPaths: async () => [],
    };
    const r = await runProtectionAuditCommand({ org: "reddoorla" }, deps);
    expect(r.code).toBe(0);
    expect(r.output).toContain("PROTECTION_AUDIT gaps=0 covered=1 skipped=0 total=1");
  });

  /**
   * THE MERGE POINT. The pnpm-pin sweep is a separate collector, but its gaps
   * must land INSIDE the offending repo's own row: `fleet-security.yml` closes
   * the tracking issue only when every repo the issue named as a GAP comes back
   * COVERED, so a repo printing GAP and COVERED in the same sweep would close
   * its own alarm. This asserts the merged shape and the counts the nightly
   * gates on, not just the verdict.
   */
  it("folds a pnpm pin gap into the repo's own row, flipping COVERED to GAP", async () => {
    const pkg = (pin: string | null) =>
      JSON.stringify(pin === null ? { name: "x" } : { name: "x", packageManager: pin });
    const deps: ProtectionAuditDeps = {
      listOrgRepos: async () => [
        { name: "espada", ...PUBLIC_CLEAN },
        { name: "naked", ...PUBLIC_CLEAN },
        { name: "drifted", ...PUBLIC_CLEAN },
      ],
      listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({
        present: true,
        blockedBranches: [],
        unknownSections: [],
      }),
      branchTip: async () => null,
      openSecretAlerts: async () => 0,
      renovateMergeWindow: async () => ({ merges: [], truncated: false }),
      // Two repos agree on 11.11.0, one does not — a STRICT majority, which is
      // what lets the third read as drift rather than as a fleet-wide split.
      repoTextFile: async (repo) =>
        repo === "reddoorla/drifted" ? pkg("pnpm@11.9.0") : pkg("pnpm@11.11.0"),
      listWorkflowPaths: async () => [],
    };
    const r = await runProtectionAuditCommand({ org: "reddoorla" }, deps);
    expect(r.code).toBe(1);
    // Anchored at column 0 for the same reason as above: the issue body is
    // extracted with `grep -E "^GAP"`.
    expect(r.output).toMatch(/^GAP {5}reddoorla\/drifted — .*packageManager is pnpm@11\.9\.0/m);
    expect(r.output).toContain("the fleet pin is pnpm@11.11.0 (2/3 repos agree)");
    // The two sound repos are untouched — the merge must not smear one repo's
    // gap across the fleet.
    expect(r.output).toMatch(/^COVERED reddoorla\/espada/m);
    expect(r.output).toMatch(/^COVERED reddoorla\/naked/m);
    expect(r.output).toContain("PROTECTION_AUDIT gaps=1 covered=2 skipped=0 total=3");
    expect(r.output).toContain("PACKAGE_MANAGER_PIN gaps=1");
    expect(r.output).toContain("fleetPin=pnpm@11.11.0");
  });

  it("a repo with no package.json is OUT OF SCOPE, never a gap (.github + the runners)", async () => {
    const deps: ProtectionAuditDeps = {
      listOrgRepos: async () => [{ name: "dot-github", ...PUBLIC_CLEAN }],
      listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({
        present: true,
        blockedBranches: [],
        unknownSections: [],
      }),
      branchTip: async () => null,
      openSecretAlerts: async () => 0,
      renovateMergeWindow: async () => ({ merges: [], truncated: false }),
      repoTextFile: async () => null,
      listWorkflowPaths: async () => [],
    };
    const r = await runProtectionAuditCommand({ org: "reddoorla" }, deps);
    expect(r.code).toBe(0);
    expect(r.output).toContain("PROTECTION_AUDIT gaps=0 covered=1 skipped=0 total=1");
    expect(r.output).toContain("out-of-scope=1");
  });
});
