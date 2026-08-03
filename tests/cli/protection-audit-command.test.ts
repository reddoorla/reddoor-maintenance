import { describe, it, expect, afterEach } from "vitest";
import {
  protectionAuditExitCode,
  runProtectionAuditCommand,
} from "../../src/cli/commands/protection-audit.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import type { ProtectionCoverageDeps } from "../../src/audits/protection-coverage.js";

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
    const deps: ProtectionCoverageDeps = {
      listOrgRepos: async () => [
        { name: "espada", ...PUBLIC_CLEAN },
        { name: "naked", ...PUBLIC_CLEAN },
        { name: "the-tower", visibility: "private", archived: false, ...SEC_ON },
      ],
      listRepoRulesets: async (repo) =>
        repo === "reddoorla/espada" ? [{ id: 1, name: FLEET_RULESET_NAME }] : [],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({ present: true, blockedBranches: [] }),
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
    const deps: ProtectionCoverageDeps = {
      listOrgRepos: async () => [{ name: "espada", ...PUBLIC_CLEAN }],
      listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
      getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
      workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
      dependencyDashboard: async () => ({ present: true, blockedBranches: [] }),
    };
    const r = await runProtectionAuditCommand({ org: "reddoorla" }, deps);
    expect(r.code).toBe(0);
    expect(r.output).toContain("PROTECTION_AUDIT gaps=0 covered=1 skipped=0 total=1");
  });
});
