import { describe, it, expect } from "vitest";
import { preflightSite, preflightFleet } from "../../src/reports/preflight.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
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

  it("does NOT flag operator addresses on the operator's own site", () => {
    const site = cleanSite({
      url: "https://reddoorla.com",
      pointOfContact: "tucker@reddoorla.com",
    });
    expect(checks(site)).not.toContain("recipient-operator-address");
  });

  it("warns when the To override shadows a different point of contact", () => {
    const site = cleanSite({ reportRecipientsTo: "other@elsewhere.com" });
    expect(checks(site)).toContain("to-override-shadows-contact");
  });

  it("fails when the header image is missing (send-time throw, surfaced early)", () => {
    expect(checks(cleanSite({ headerImage: null }))).toContain("header-image-missing");
  });

  it("warns for announcements when Lighthouse scores are missing", () => {
    expect(checks(cleanSite({ pScore: null }))).toContain("scores-missing");
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

  it("fails on an unrecognized frequency value", () => {
    expect(checks(cleanSite({ maintenanceFreq: "Quaterly" as never }))).toContain(
      "frequency-unrecognized",
    );
  });

  it("warns on an anchor more than ~13 months old (the ERP/Reddoor testing-day case)", () => {
    const site = cleanSite({ testingFreq: "Yearly", testingDay: "2025-01-15" });
    expect(checks(site)).toContain("anchor-stale");
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
    expect(f?.level).toBe("warn");
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
