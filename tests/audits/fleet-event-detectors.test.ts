import { describe, it, expect } from "vitest";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import {
  backupEventFromVerify,
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
    const stayedGreen = detectSignalEvents(
      site({ defaultBranchCi: "passing" }),
      { ...row },
      [],
      AT,
    );
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

// P1-87 PR 9 (a). The nightly restore rehearsal's machine line, parsed. Only a
// clean line records; every other shape is null, so a failed rehearsal cannot
// reach the feed even if the workflow step that calls this ever runs.
describe("backupEventFromVerify", () => {
  const CLEAN =
    "DUMP_VERIFY loaded=true tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=0";

  it("records one clean rehearsal line, with its counts in data", () => {
    const e = backupEventFromVerify(CLEAN, AT);
    expect(e).toEqual({
      id: "backup_verified:2026-06-25",
      ts: AT,
      type: "backup_verified",
      siteId: null,
      siteName: null,
      summary: "Backup restored in rehearsal: 44 tables, 12,345 rows",
      data: { tables: 44, rows: 12345 },
    });
  });

  it("takes rows from the rows field, never from blob_bytes", () => {
    const e = backupEventFromVerify(
      "DUMP_VERIFY loaded=true tables=9 rows=340 blob_bytes=99999 hashed=9 mismatches=0",
      AT,
    );
    expect(e?.data).toEqual({ tables: 9, rows: 340 });
  });

  it("ignores the check's own ✗ lines and any text around the one machine line", () => {
    const e = backupEventFromVerify(`${CLEAN}\n`, AT);
    expect(e?.data).toEqual({ tables: 44, rows: 12345 });
  });

  it.each([
    [
      "a failed rehearsal (mismatches=3)",
      "DUMP_VERIFY loaded=true tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=3",
    ],
    [
      "a single mismatch (mismatches=1)",
      "DUMP_VERIFY loaded=true tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=1",
    ],
    [
      "a dump that did not load",
      "DUMP_VERIFY loaded=false tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=0",
    ],
    [
      "a manifest-less dump",
      "DUMP_VERIFY loaded=true manifest=absent — dump predates the origin manifest",
    ],
    [
      "a non-integer table count",
      "DUMP_VERIFY loaded=true tables=4x rows=12345 blob_bytes=987 hashed=44 mismatches=0",
    ],
    [
      "a non-integer row count",
      "DUMP_VERIFY loaded=true tables=44 rows=1.5 blob_bytes=987 hashed=44 mismatches=0",
    ],
    // #2200, the operator's answer (a): 0 tables restored is not a verified backup.
    [
      "a rehearsal that restored no table",
      "DUMP_VERIFY loaded=true tables=0 rows=0 blob_bytes=0 hashed=0 mismatches=0",
    ],
    ["no machine line at all", "✗ sites: dump=44 restored=43"],
    ["empty text", ""],
  ])("returns null for %s", (_name, text) => {
    expect(backupEventFromVerify(text, AT)).toBeNull();
  });

  // #2198: the same refusal with the failed line first, so a parser that reads
  // the last line (the clean one) cannot pass.
  it("returns null when two machine lines disagree, the failed one first", () => {
    expect(
      backupEventFromVerify(
        `DUMP_VERIFY loaded=true tables=44 rows=12000 blob_bytes=987 hashed=44 mismatches=3\n${CLEAN}`,
        AT,
      ),
    ).toBeNull();
  });

  it("returns null when two machine lines disagree", () => {
    expect(
      backupEventFromVerify(
        `${CLEAN}\nDUMP_VERIFY loaded=true tables=44 rows=12000 blob_bytes=987 hashed=44 mismatches=3`,
        AT,
      ),
    ).toBeNull();
  });
});

// P1-87 PR 9 (b). A new published production deploy is one event, stamped with the
// time it was published. A site's first-ever reading records nothing (no flood on the
// first night), an unchanged deployedAt records nothing, and only a `ready` state
// with a valid time counts as published.
describe("detectAuditEvents — site_deployed", () => {
  const DEPLOYED = "2026-06-25T06:30:00.000Z";
  const PREV_DEPLOY = "2026-06-24T06:30:00.000Z";
  const deploy = (over: Partial<{ state: string | null; deployedAt: string | null }>) => ({
    state: "ready",
    deployedAt: DEPLOYED,
    logUrl: "https://example.netlify.app",
    checkedAt: AT,
    ...over,
  });
  const deployEvents = (prev: WebsiteRow, nd: ReturnType<typeof deploy>) =>
    detectAuditEvents(prev, { netlifyDeploy: nd }, AT).filter((e) => e.type === "site_deployed");

  it("records a new published deploy once, stamped with deployedAt, not the audit time", () => {
    const events = deployEvents(site({ lastDeployAt: PREV_DEPLOY }), deploy({}));
    expect(events).toEqual([
      {
        id: `site_deployed:recSITE:${DEPLOYED}`,
        ts: DEPLOYED,
        type: "site_deployed",
        siteId: "recSITE",
        siteName: "Caltex",
        summary: "Deploy published",
        data: null,
      },
    ]);
  });

  it("records nothing on a site's first-ever reading (prior lastDeployAt null)", () => {
    expect(deployEvents(site({ lastDeployAt: null }), deploy({}))).toEqual([]);
  });

  it("records nothing when deployedAt is unchanged", () => {
    expect(deployEvents(site({ lastDeployAt: DEPLOYED }), deploy({}))).toEqual([]);
  });

  it.each([
    ["an erroring build", "error"],
    ["a failed build", "failed"],
    ["a rejected build", "rejected"],
    ["a build still in progress", "building"],
    ["a deploy with no state", null],
  ])("records nothing for %s", (_name, state) => {
    expect(deployEvents(site({ lastDeployAt: PREV_DEPLOY }), deploy({ state }))).toEqual([]);
  });

  it("records nothing when the deploy time is unparseable or absent", () => {
    expect(
      deployEvents(site({ lastDeployAt: PREV_DEPLOY }), deploy({ deployedAt: "not-a-time" })),
    ).toEqual([]);
    expect(deployEvents(site({ lastDeployAt: PREV_DEPLOY }), deploy({ deployedAt: null }))).toEqual(
      [],
    );
  });

  it("is silent when no netlify-deploy audit ran this night", () => {
    expect(detectAuditEvents(site({ lastDeployAt: PREV_DEPLOY }), {}, AT)).toEqual([]);
  });
});
