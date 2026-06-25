import { describe, it, expect } from "vitest";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import {
  cleanRenovateTitle,
  detectAuditEvents,
  detectSignalEvents,
  fleetSweptEvent,
} from "../../src/audits/fleet-event-detectors.js";

const AT = "2026-06-25T07:00:00.000Z";

// Minimal WebsiteRow factory — only the fields the detectors read matter.
function site(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "recSITE",
    name: "Caltex",
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    certDaysRemaining: null,
    defaultBranchCi: null,
    ...over,
  } as WebsiteRow;
}

describe("cleanRenovateTitle", () => {
  it("strips the conventional-commit + update-dependency prefix and arrows the version", () => {
    expect(cleanRenovateTitle("chore(deps): update dependency vite to v7.3.5 [security]")).toBe(
      "vite→7.3.5 [security]",
    );
    expect(cleanRenovateTitle("fix(deps): update dependency @sveltejs/kit to v2.68.0")).toBe(
      "@sveltejs/kit→2.68.0",
    );
  });
  it("leaves a grouped/no-version title readable", () => {
    expect(cleanRenovateTitle("chore(deps): update all non-major dependencies")).toBe(
      "all non-major dependencies",
    );
  });
});

describe("detectAuditEvents — vuln_cleared", () => {
  it("fires on >0 → 0 (critical+high)", () => {
    const events = detectAuditEvents(
      site({ securityVulnsCritical: 1, securityVulnsHigh: 2 }),
      { security: { critical: 0, high: 0, moderate: 3, low: 4 } },
      AT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("vuln_cleared");
    expect(events[0]!.id).toBe("vuln_cleared:recSITE:2026-06-25");
    expect(events[0]!.summary).toContain("3"); // 1 critical + 2 high
  });
  it("does NOT fire on 5 → 2 (still vulnerable)", () => {
    const events = detectAuditEvents(
      site({ securityVulnsCritical: 2, securityVulnsHigh: 3 }),
      { security: { critical: 1, high: 1, moderate: 0, low: 0 } },
      AT,
    );
    expect(events).toHaveLength(0);
  });
  it("does NOT fire on 0 → 0 or never-audited (null) → 0", () => {
    expect(
      detectAuditEvents(
        site({ securityVulnsCritical: 0, securityVulnsHigh: 0 }),
        { security: { critical: 0, high: 0, moderate: 0, low: 0 } },
        AT,
      ),
    ).toHaveLength(0);
    expect(
      detectAuditEvents(site({}), { security: { critical: 0, high: 0, moderate: 0, low: 0 } }, AT),
    ).toHaveLength(0);
  });
});

describe("detectAuditEvents — cert_renewed", () => {
  it("fires on <30 → >60", () => {
    const events = detectAuditEvents(
      site({ certDaysRemaining: 12 }),
      { domain: { certDaysRemaining: 89, checkedAt: AT } },
      AT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("cert_renewed");
    expect(events[0]!.id).toBe("cert_renewed:recSITE:2026-06-25");
  });
  it("does NOT fire on healthy → healthy (80 → 90)", () => {
    expect(
      detectAuditEvents(
        site({ certDaysRemaining: 80 }),
        { domain: { certDaysRemaining: 90, checkedAt: AT } },
        AT,
      ),
    ).toHaveLength(0);
  });
  it("does NOT fire on a null prior (first measurement, not a renewal)", () => {
    expect(
      detectAuditEvents(site({}), { domain: { certDaysRemaining: 89, checkedAt: AT } }, AT),
    ).toHaveLength(0);
  });
});

describe("detectSignalEvents", () => {
  const row = {
    site: "caltex",
    repo: "reddoorla/caltex",
    renovateFailingCis: 0,
    ciState: "passing" as const,
    lastCommitAt: null,
  };

  it("emits one pr_automerged per merged PR with a deterministic id", () => {
    const events = detectSignalEvents(
      site({ defaultBranchCi: "passing" }),
      { ...row },
      [
        {
          number: 14,
          title: "chore(deps): update dependency vite to v7.3.5 [security]",
          url: "https://github.com/reddoorla/caltex/pull/14",
          mergedAt: "2026-06-24T09:00:00.000Z",
        },
      ],
      AT,
    );
    const pr = events.find((e) => e.type === "pr_automerged")!;
    expect(pr.id).toBe("pr_automerged:reddoorla/caltex#14");
    expect(pr.ts).toBe("2026-06-24T09:00:00.000Z");
    expect(pr.summary).toBe("auto-merged vite→7.3.5 [security]");
    expect(pr.data).toEqual({
      url: "https://github.com/reddoorla/caltex/pull/14",
      repo: "reddoorla/caltex",
      number: 14,
    });
  });

  it("emits ci_recovered only on failing → passing", () => {
    const recovered = detectSignalEvents(site({ defaultBranchCi: "failing" }), { ...row }, [], AT);
    expect(recovered.some((e) => e.type === "ci_recovered")).toBe(true);
    const stayedGreen = detectSignalEvents(site({ defaultBranchCi: "passing" }), { ...row }, [], AT);
    expect(stayedGreen.some((e) => e.type === "ci_recovered")).toBe(false);
  });
});

describe("fleetSweptEvent", () => {
  it("builds a per-day rollup id and a human summary", () => {
    const e = fleetSweptEvent("security", 11, AT);
    expect(e.id).toBe("fleet_swept:security:2026-06-25");
    expect(e.type).toBe("fleet_swept");
    expect(e.siteId).toBeNull();
    expect(e.summary).toBe("security-swept 11 sites");
    expect(fleetSweptEvent("lighthouse", 1, AT).summary).toBe("re-audited 1 site");
  });
});
