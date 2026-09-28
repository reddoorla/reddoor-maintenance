import { describe, it, expect } from "vitest";
import { retickEvidence } from "../../src/reports/retick.js";
import { approveBlockers } from "../../src/reports/preflight.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const CHECKED = "2026-09-27T13:40:57.211Z";
const GOOGLE = "Maint: Google Indexed";
const GATING = [
  "Maint: Deploy & Function Health",
  "Maint: CMS Checked",
  "Maint: Domain, DNS & SSL",
  "Maint: Security Updates",
  "Maint: Uptime Checked",
];
const NOT_MEASURED: EvidenceRecord = {
  result: "unknown",
  checkedAt: null,
  note: "Not yet measured",
};

const SITE = makeWebsiteRow({
  url: "https://acme.com",
  pointOfContact: "client@acme.com",
  headerImage: { url: "https://x/p.jpg", filename: "p.jpg", type: "image/jpeg" },
  netlifyId: "n1",
  deployStatus: "ready",
  deployCheckedAt: CHECKED,
  functionHealth: "pass",
  cmsReachable: "pass",
  functionHealthCheckedAt: CHECKED,
  certDaysRemaining: 80,
  domainCheckedAt: CHECKED,
  securityVulnsCritical: 0,
  securityVulnsHigh: 0,
  lastSecurityAuditAt: CHECKED,
  reachableOk: "pass",
  browserCheckedAt: CHECKED,
});

function frozen(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "Acme Co — Maintenance — 2026-09-17",
    siteId: SITE.id,
    reportType: "Maintenance",
    lighthouse: { performance: 91, accessibility: 100, bestPractices: 96, seo: 100 },
    sentAt: null,
    approvedToSend: false,
    sendOverride: false,
    overrideReason: null,
    checklist: Object.fromEntries(GATING.map((f) => [f, false])),
    autoEvidence: Object.fromEntries(GATING.map((f) => [f, NOT_MEASURED])),
    ...over,
  } as ReportRow;
}

describe("retickEvidence (#890)", () => {
  it("turns a draft frozen before its site was measured into an approvable one", () => {
    const before = frozen();
    expect(approveBlockers(SITE, before).filter((f) => f.check === "health-gate")).toHaveLength(5);

    const out = retickEvidence(SITE, before, NOW);
    expect(out.status).toBe("reticked");
    if (out.status !== "reticked") return;
    expect(out.changed.sort()).toEqual([...GATING].sort());
    expect(out.ticked.sort()).toEqual([...GATING].sort());
    for (const f of GATING) {
      expect(out.autoEvidence[f]!.result).toBe("pass");
      expect(out.checklist[f]).toBe(true);
    }
    expect(approveBlockers(SITE, { ...before, ...out })).toEqual([]);
  });

  it("reports unchanged when the stored evidence already matches current health", () => {
    const first = retickEvidence(SITE, frozen(), NOW);
    if (first.status !== "reticked") throw new Error("expected a re-tick");
    const again = frozen({ autoEvidence: first.autoEvidence, checklist: first.checklist });
    expect(retickEvidence(SITE, again, NOW)).toEqual({ status: "unchanged" });
  });

  it("locks an approved report and a sent one", () => {
    expect(retickEvidence(SITE, frozen({ approvedToSend: true }), NOW)).toEqual({
      status: "locked",
    });
    expect(retickEvidence(SITE, frozen({ sentAt: "2026-09-20T09:23:00.000Z" }), NOW)).toEqual({
      status: "locked",
    });
  });

  it("keeps the draft-time Google Indexed record, which only a draft can measure", () => {
    const google: EvidenceRecord = { result: "pass", checkedAt: CHECKED, note: "Page 1 on Google" };
    const out = retickEvidence(
      SITE,
      frozen({
        reportType: "Testing",
        autoEvidence: { ...frozen().autoEvidence, [GOOGLE]: google },
      }),
      NOW,
    );
    if (out.status !== "reticked") throw new Error("expected a re-tick");
    expect(out.autoEvidence[GOOGLE]).toEqual(google);
    expect(out.changed).not.toContain(GOOGLE);
  });

  it("records a regression honestly and never un-ticks a box", () => {
    const passing = retickEvidence(SITE, frozen(), NOW);
    if (passing.status !== "reticked") throw new Error("expected a re-tick");
    const broken = makeWebsiteRow({ ...SITE, securityVulnsHigh: 2 });
    const out = retickEvidence(
      broken,
      frozen({ autoEvidence: passing.autoEvidence, checklist: passing.checklist }),
      NOW,
    );
    if (out.status !== "reticked") throw new Error("expected a re-tick");
    expect(out.changed).toEqual(["Maint: Security Updates"]);
    expect(out.autoEvidence["Maint: Security Updates"]!.result).toBe("fail");
    expect(out.ticked).toEqual([]);
    expect(out.checklist["Maint: Security Updates"]).toBe(true);
  });

  it("ticks only boxes whose evidence changed, leaving an unticked unchanged box alone", () => {
    const passing = retickEvidence(SITE, frozen(), NOW);
    if (passing.status !== "reticked") throw new Error("expected a re-tick");
    const broken = makeWebsiteRow({ ...SITE, securityVulnsHigh: 2 });
    const out = retickEvidence(
      broken,
      frozen({
        autoEvidence: passing.autoEvidence,
        checklist: { ...passing.checklist, "Maint: CMS Checked": false },
      }),
      NOW,
    );
    if (out.status !== "reticked") throw new Error("expected a re-tick");
    expect(out.checklist["Maint: CMS Checked"]).toBe(false);
  });

  it("degrades to unknown when the site's audits have gone stale", () => {
    const later = new Date("2026-10-05T12:00:00.000Z");
    const out = retickEvidence(SITE, frozen(), later);
    if (out.status !== "reticked") throw new Error("expected a re-tick");
    for (const f of GATING) expect(out.autoEvidence[f]!.result).toBe("unknown");
    expect(out.ticked).toEqual([]);
  });
});
