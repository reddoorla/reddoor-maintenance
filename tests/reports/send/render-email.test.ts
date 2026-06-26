import { describe, it, expect } from "vitest";
import { renderReportEmail, type PreparedHeader } from "../../../src/reports/send/render-email.js";
import type { ReportData } from "../../../src/reports/types.js";

const HEADER: PreparedHeader = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "image/jpeg",
  displayWidth: 600,
  displayHeight: 200,
  placeholderColor: "#eee",
};

function reportData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Maintenance",
    completedOn: new Date("2026-05-26T12:00:00Z"),
    lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 95 },
    gaUsersCurrent: 12345,
    gaUsersPrevious: 6789,
    lastTestedDate: new Date("2025-01-01T00:00:00Z"),
    commentary: null,
    headerImageCid: "acme-co-header",
    headerWidth: HEADER.displayWidth,
    headerHeight: HEADER.displayHeight,
    headerBgColor: HEADER.placeholderColor,
    ...over,
  };
}

describe("renderReportEmail", () => {
  it("always attaches the header, and gates bundled images on the cid appearing in the HTML", async () => {
    const { html, attachments } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    const cids = attachments.map((a) => a.inlineContentId);
    expect(cids).toContain("acme-co-header"); // header always
    // Maintenance renders the green check and the blurred-tests image, so both attach.
    expect(cids).toContain("rd-check-png");
    expect(html).toContain("ANALYTICS"); // sanity: it actually rendered the report
  });

  it("does not attach a bundled image the HTML doesn't reference (Launch has no check)", async () => {
    const { attachments } = await renderReportEmail(reportData({ reportType: "Launch" }), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    const cids = attachments.map((a) => a.inlineContentId);
    expect(cids).toEqual(["acme-co-header"]); // header only
  });

  it("uses defaultReportSubject when no override is given", async () => {
    const { subject } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
    });
    expect(subject).toBe("Acme Co — May 2026 Maintenance Report");
  });

  it("prefers an explicit subjectOverride", async () => {
    const { subject } = await renderReportEmail(reportData(), {
      header: HEADER,
      cidName: "acme-co-header",
      subjectOverride: "Custom Subject",
    });
    expect(subject).toBe("Custom Subject");
  });
});
