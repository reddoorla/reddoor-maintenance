import { describe, it, expect } from "vitest";
import {
  preflightSite,
  preflightFleet,
  approveBlockers,
  formatBlockers,
  healthBlockers,
} from "../../src/reports/preflight.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-07-02T12:00:00Z");

function makeReportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "REP-1",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-07",
    periodStart: null,
    periodEnd: null,
    completedOn: null,
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: false,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    ...over,
  };
}

/** A site that passes every check, per-test breakage comes in via `over`. */
function cleanSite(over: Parameters<typeof makeWebsiteRow>[0] = {}) {
  return makeWebsiteRow({
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "owner@acme.example.com",
    maintenanceFreq: "Monthly",
    maintenanceFreqRaw: "Monthly",
    testingFreq: "None",
    maintenanceDay: "2026-06-30",
    headerImage: { url: "https://x/img.png", filename: "img.png", type: "image/png" },
    pScore: 90,
    rScore: 100,
    bpScore: 100,
    seoScore: 100,
    ...over,
  });
}

function checks(site: ReturnType<typeof cleanSite>, reports: ReportRow[] = []) {
  return preflightSite(site, reports, "Announcement", NOW).findings.map((f) => f.check);
}

describe("preflightSite", () => {
  it("passes a fully-configured site with no findings", () => {
    expect(checks(cleanSite())).toEqual([]);
  });

  it("fails when To and point of contact are both empty", () => {
    expect(checks(cleanSite({ pointOfContact: null }))).toContain("recipients-missing");
  });

  it("fails on a malformed recipient address", () => {
    expect(checks(cleanSite({ reportRecipientsTo: "Bob <bob@x.com>" }))).toContain(
      "recipients-malformed",
    );
  });

  it("warns when a client site's resolved To is an operator address (the ERP case)", () => {
    const findings = preflightSite(
      cleanSite({ reportRecipientsTo: "tucker@reddoorla.com" }),
      [],
      "Announcement",
      NOW,
    ).findings;
    const f = findings.find((x) => x.check === "recipient-operator-address");
    expect(f?.level).toBe("warn");
    expect(f?.message).toContain("tucker@reddoorla.com");
  });

  it("softens the message when operator address rides ALONGSIDE the client's", () => {
    const site = cleanSite({
      reportRecipientsTo: "tucker@reddoorla.com, owner@acme.example.com",
    });
    const f = preflightSite(site, [], "Announcement", NOW).findings.find(
      (x) => x.check === "recipient-operator-address",
    );
    expect(f?.message).toContain("alongside");
  });

  it("treats a bare domain pasted as contact as malformed, not as an operator address", () => {
    const site = cleanSite({ pointOfContact: "reddoorla.com" });
    const ids = checks(site);
    expect(ids).toContain("recipients-malformed");
    expect(ids).not.toContain("recipient-operator-address");
  });

  it("recognizes the operator's own site even when the url cell has no scheme", () => {
    const site = cleanSite({ url: "reddoorla.com", pointOfContact: "tucker@reddoorla.com" });
    expect(checks(site)).not.toContain("recipient-operator-address");
  });

  it("does NOT flag operator addresses on the operator's own site", () => {
    const site = cleanSite({
      url: "https://reddoorla.com",
      pointOfContact: "tucker@reddoorla.com",
    });
    expect(checks(site)).not.toContain("recipient-operator-address");
  });

  it("notes (info) when the To override shadows a different point of contact", () => {
    const site = cleanSite({ reportRecipientsTo: "other@elsewhere.com" });
    const f = preflightSite(site, [], "Announcement", NOW).findings.find(
      (x) => x.check === "to-override-shadows-contact",
    );
    expect(f?.level).toBe("info");
  });

  it("does not flag an override that is the same address set in a different order", () => {
    const site = cleanSite({
      pointOfContact: "a@acme.example.com, b@acme.example.com",
      reportRecipientsTo: "B@acme.example.com, a@acme.example.com",
    });
    expect(checks(site)).not.toContain("to-override-shadows-contact");
  });

  it("fails when the header image is missing (send-time throw, surfaced early)", () => {
    expect(checks(cleanSite({ headerImage: null }))).toContain("header-image-missing");
  });

  it("warns for announcements when Lighthouse scores are missing (announce skips the site)", () => {
    const f = preflightSite(cleanSite({ pScore: null }), [], "Announcement", NOW).findings.find(
      (x) => x.check === "scores-missing",
    );
    expect(f?.level).toBe("warn");
  });

  it("FAILS for maintenance/testing when scores are missing (drafting hard-throws in scoresFromWebsite)", () => {
    const f = preflightSite(cleanSite({ pScore: null }), [], "Maintenance", NOW).findings.find(
      (x) => x.check === "scores-missing",
    );
    expect(f?.level).toBe("fail");
  });

  it("warns on unsent queued drafts, naming type/period and approval state", () => {
    const findings = preflightSite(
      cleanSite(),
      [
        makeReportRow({ draftReady: true, reportType: "Maintenance", period: "2026-07" }),
        makeReportRow({
          id: "recREP2",
          draftReady: true,
          approvedToSend: true,
          reportType: "Testing",
          period: "2026-06",
        }),
        makeReportRow({ id: "recREP3", draftReady: true, sentAt: "2026-06-30" }), // sent → ignored
      ],
      "Announcement",
      NOW,
    ).findings;
    const f = findings.find((x) => x.check === "pending-drafts");
    expect(f?.level).toBe("warn");
    expect(f?.message).toContain("2 unsent");
    expect(f?.message).toContain("Maintenance 2026-07");
    expect(f?.message).toContain("Testing 2026-06 [APPROVED]");
  });

  it("downgrades the current-cycle same-type draft to info for maintenance runs (send-day steady state)", () => {
    const current = makeReportRow({
      draftReady: true,
      approvedToSend: true,
      reportType: "Maintenance",
      period: "2026-07",
    });
    const staleTesting = makeReportRow({
      id: "recREP9",
      draftReady: true,
      reportType: "Testing",
      period: "2026-01",
    });
    const findings = preflightSite(
      cleanSite(),
      [current, staleTesting],
      "Maintenance",
      NOW,
    ).findings;
    const pendings = findings.filter((x) => x.check === "pending-drafts");
    expect(pendings.map((p) => p.level).sort()).toEqual(["info", "warn"]);
    expect(pendings.find((p) => p.level === "info")?.message).toContain("current-cycle");
    expect(pendings.find((p) => p.level === "warn")?.message).toContain("Testing 2026-01");
  });

  it("fails on an unrecognized RAW frequency cell (mapRow coerces it to None before we see it)", () => {
    const site = cleanSite({ maintenanceFreq: "None", maintenanceFreqRaw: "Quaterly" });
    expect(checks(site)).toContain("frequency-unrecognized");
  });

  it("stays quiet on a trailing-space frequency cell ('Monthly ') — toFrequency trims, so it schedules", () => {
    // mapRow now reads "Monthly " as Monthly, so the coerced value is NOT "None"
    // and there is nothing to flag — the site stays on the calendar.
    const site = cleanSite({ maintenanceFreq: "Monthly", maintenanceFreqRaw: "Monthly " });
    expect(checks(site)).not.toContain("frequency-unrecognized");
  });

  it("stays quiet on a clean raw frequency and on blank cells", () => {
    expect(checks(cleanSite())).toEqual([]);
    const blank = cleanSite({ maintenanceFreq: "None", maintenanceFreqRaw: null });
    expect(checks(blank)).not.toContain("frequency-unrecognized");
  });

  it("warns on an anchor more than ~13 months old with no newer send (the ERP/Reddoor case)", () => {
    const site = cleanSite({ testingFreq: "Yearly", testingDay: "2025-01-15" });
    expect(checks(site)).toContain("anchor-stale");
  });

  it("suppresses anchor-stale when a newer Sent-at supersedes the anchor (due.ts uses lastSent ?? anchor)", () => {
    const site = cleanSite({ testingFreq: "Yearly", testingDay: "2025-01-15" });
    const sent = makeReportRow({ reportType: "Testing", sentAt: "2026-05-01" });
    expect(checks(site, [sent])).not.toContain("anchor-stale");
  });

  it("infos when no anchors exist and nothing was ever sent (Sonder playbook reminder)", () => {
    const site = cleanSite({ maintenanceDay: null, testingDay: null });
    expect(checks(site)).toContain("anchor-missing");
  });

  it("suppresses anchor-missing when a report was previously sent", () => {
    const sent = makeReportRow({ sentAt: "2026-05-01", reportType: "Maintenance" });
    const site = cleanSite({ maintenanceDay: null, testingDay: null });
    expect(checks(site, [sent])).not.toContain("anchor-missing");
  });

  it("infos non-maintenance status for announcements", () => {
    expect(checks(cleanSite({ status: "launch period" }))).toContain("status-not-maintenance");
  });

  it("skips send-requirement checks for a site not on the checked calendar (freq None)", () => {
    const site = cleanSite({
      maintenanceFreq: "None",
      maintenanceFreqRaw: "None",
      pointOfContact: null,
      headerImage: null,
      pScore: null,
    });
    const findings = preflightSite(site, [], "Maintenance", NOW).findings;
    const ids = findings.map((f) => f.check);
    expect(ids).toContain("not-scheduled");
    expect(ids).not.toContain("recipients-missing");
    expect(ids).not.toContain("header-image-missing");
    expect(ids).not.toContain("scores-missing");
    expect(findings.every((f) => f.level === "info")).toBe(true);
  });

  it("still fails frequency typos and warns pending drafts on unscheduled sites", () => {
    const site = cleanSite({
      maintenanceFreq: "None",
      maintenanceFreqRaw: "Quaterly",
      pointOfContact: null,
    });
    const draft = makeReportRow({ draftReady: true, reportType: "Maintenance", period: "2026-01" });
    const ids = preflightSite(site, [draft], "Maintenance", NOW).findings.map((f) => f.check);
    expect(ids).toContain("frequency-unrecognized");
    expect(ids).toContain("pending-drafts");
  });
});

describe("preflightFleet", () => {
  it("warns when a load-bearing column is empty across every site (rename detector)", () => {
    const sites = [1, 2, 3].map((i) =>
      cleanSite({ id: `rec${i}`, name: `Site ${i}`, pointOfContact: null }),
    );
    const findings = preflightFleet(sites);
    expect(findings.map((f) => f.check)).toContain("column-possibly-renamed");
    expect(findings[0]!.message).toContain("point of contact");
  });

  it("stays quiet when values exist somewhere", () => {
    const sites = [
      cleanSite({ id: "rec1" }),
      cleanSite({ id: "rec2", name: "B", pointOfContact: null }),
      cleanSite({ id: "rec3", name: "C", pointOfContact: "c@c.example.com" }),
    ];
    expect(preflightFleet(sites)).toEqual([]);
  });

  it("does not guess renames from fewer than 3 rows", () => {
    expect(preflightFleet([cleanSite({ pointOfContact: null })])).toEqual([]);
  });

  it("warns when two different sites resolve to the same contact (the MSOT/Revogen case)", () => {
    const sites = [
      cleanSite({ id: "rec1", name: "MSOT", pointOfContact: "albert@revogen.example.com" }),
      cleanSite({ id: "rec2", name: "Revogen", pointOfContact: "albert@revogen.example.com" }),
      cleanSite({ id: "rec3", name: "Other", pointOfContact: "someone@else.example.com" }),
    ];
    const f = preflightFleet(sites).find((x) => x.check === "duplicate-contact");
    expect(f?.level).toBe("info");
    expect(f?.message).toContain("MSOT and Revogen");
    expect(f?.message).toContain("albert@revogen.example.com");
  });

  it("does not flag shared operator addresses as duplicate contacts", () => {
    const sites = [
      cleanSite({ id: "rec1", name: "A", reportRecipientsTo: "tucker@reddoorla.com" }),
      cleanSite({ id: "rec2", name: "B", reportRecipientsTo: "tucker@reddoorla.com" }),
      cleanSite({ id: "rec3", name: "C" }),
    ];
    const checks = preflightFleet(sites).map((x) => x.check);
    expect(checks).not.toContain("duplicate-contact");
  });
});

/** An all-pass Maintenance gating evidence map, so pre-existing recipients/header/scores
 *  tests below stay health-clean and keep testing exactly what they tested before
 *  healthBlockers was folded into approveBlockers. Tests that care about health override
 *  autoEvidence explicitly. */
const healthCleanEvidence = (): Record<string, EvidenceRecord> =>
  Object.fromEntries(
    [
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
    ].map((f) => [f, { result: "pass", checkedAt: "2026-07-06T00:00:00.000Z", note: "" }]),
  );

describe("approveBlockers", () => {
  const REPORT = () =>
    makeReportRow({
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
      autoEvidence: healthCleanEvidence(),
    });

  it("returns no findings for a send-clean site + report", () => {
    expect(approveBlockers(cleanSite(), REPORT())).toEqual([]);
  });

  it.each([
    ["recipients-missing", { pointOfContact: null }],
    ["recipients-malformed", { pointOfContact: "Bob <bob@x.com>" }],
    ["header-image-missing", { headerImage: null }],
  ] as const)("fails on %s", (check, over) => {
    const fails = formatBlockers(approveBlockers(cleanSite(over), REPORT()));
    expect(fails.join(" ")).toContain(check);
  });

  it("fails when the Header image attachment is not a decodable image (send throws in prepareHeaderImage)", () => {
    const site = cleanSite({
      headerImage: { url: "https://x/doc.pdf", filename: "doc.pdf", type: "application/pdf" },
    });
    expect(formatBlockers(approveBlockers(site, REPORT())).join(" ")).toContain(
      "header-image-not-image",
    );
    expect(checks(site)).toContain("header-image-not-image");
  });

  it("fails when the REPORT row has no lighthouse snapshot (sendOne throws on it)", () => {
    const fails = formatBlockers(approveBlockers(cleanSite(), makeReportRow({ lighthouse: null })));
    expect(fails.join(" ")).toContain("report-scores-missing");
  });

  it("does not fail on site-level scores — the report snapshot is what sends", () => {
    const fails = formatBlockers(approveBlockers(cleanSite({ pScore: null }), REPORT()));
    expect(fails).toEqual([]);
  });

  it("warns (does not block) when the To is only operator addresses", () => {
    const findings = approveBlockers(
      cleanSite({ pointOfContact: "tucker@reddoorla.com" }),
      REPORT(),
    );
    expect(findings.map((f) => f.level)).toEqual(["warn"]);
    expect(formatBlockers(findings)).toEqual([]);
  });

  it("ignores schedule hygiene entirely (not this report's problem)", () => {
    const site = cleanSite({ maintenanceFreq: "None", maintenanceFreqRaw: "Quaterly" });
    expect(formatBlockers(approveBlockers(site, REPORT()))).toEqual([]);
  });
});

const passEv = { result: "pass" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "" };
const failEv = { result: "fail" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "down" };

describe("healthBlockers", () => {
  it("returns [] when every gating field is pass (Maintenance)", () => {
    const autoEvidence = Object.fromEntries(
      [
        "Maint: Deploy & Function Health",
        "Maint: CMS Checked",
        "Maint: Domain, DNS & SSL",
        "Maint: Security Updates",
        "Maint: Uptime Checked",
      ].map((f) => [f, passEv]),
    );
    expect(healthBlockers(makeReportRow({ reportType: "Maintenance", autoEvidence }))).toEqual([]);
  });
  it("emits a fail finding for a failing gating field and for an absent one", () => {
    const autoEvidence = { "Maint: CMS Checked": failEv };
    const findings = healthBlockers(makeReportRow({ reportType: "Maintenance", autoEvidence }));
    expect(findings.every((f) => f.level === "fail" && f.check === "health-gate")).toBe(true);
    expect(findings.some((f) => f.message.includes("Maint: CMS Checked"))).toBe(true);
    // Uptime is absent → unknown → blocks too.
    expect(findings.some((f) => f.message.includes("Maint: Uptime Checked"))).toBe(true);
  });
});

describe("approveBlockers folds in health-gate findings", () => {
  it("adds a health-gate fail when a gating item is not green (recipients/header/scores clean)", () => {
    const site = makeWebsiteRow({
      reportRecipientsTo: "client@acme.com",
      headerImage: { url: "u", filename: "h.png", type: "image/png" },
    });
    const report = makeReportRow({
      reportType: "Maintenance",
      lighthouse: { performance: 90, accessibility: 90, bestPractices: 90, seo: 90 },
      autoEvidence: { "Maint: CMS Checked": failEv },
    });
    const findings = approveBlockers(site, report);
    expect(findings.some((f) => f.check === "health-gate")).toBe(true);
  });
});
