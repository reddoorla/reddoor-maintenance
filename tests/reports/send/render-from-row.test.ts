import { describe, it, expect, vi } from "vitest";
import type { WebsiteRow } from "../../../src/reports/airtable/websites.js";
import type { ReportRow } from "../../../src/reports/airtable/reports.js";
import { makeWebsiteRow } from "../../_helpers/website-row.js";

/**
 * The ONE path from a stored report row to the rendered email (#539 Phase 4).
 *
 * It exists so an on-demand re-render and the real send cannot drift: a preview
 * whose only job is fidelity is worthless if it renders through a second code
 * path that agrees with the sender only by coincidence. `sendOne` assembles its
 * `ReportData` inline today; this lifts that assembly out unchanged so both go
 * through it.
 *
 * Header processing is stubbed here for the same reason orchestrate.test.ts
 * stubs it: sharp's real work is covered in header-image.test.ts, and the fetch
 * stub hands over placeholder bytes rather than a decodable JPEG.
 */
vi.mock("../../../src/reports/maintenance-email/header-image.js", () => ({
  prepareHeaderImage: vi.fn(async () => ({
    bytes: new Uint8Array([255, 216, 255]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 800,
    placeholderColor: "#cccccc",
  })),
}));

vi.mock("../../../src/reports/header-image/index.js", () => ({
  applyReportTypeHeadline: vi.fn(async (bytes: Uint8Array) => bytes),
}));

const { renderReportFromRow } = await import("../../../src/reports/send/render-from-row.js");

const PLATE = new Uint8Array([1, 2, 3]);

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintained",
    ...over,
  });
}

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "ACME-2026-08-M",
    siteId: "recSITE",
    reportType: "Maintenance",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    completedOn: "2026-09-01",
    lighthouse: { performance: 98, accessibility: 100, bestPractices: 96, seo: 92 },
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    deliveryStatus: "pending",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    period: "2026-08",
    checklist: {},
    autoEvidence: null,
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    ...over,
  } as ReportRow;
}

describe("renderReportFromRow", () => {
  it("renders the report's CURRENT commentary into the html", async () => {
    // The whole point of an on-demand re-render: commentary edited after drafting
    // has to appear. The draft-time artifact by definition cannot show it.
    const r = await renderReportFromRow(
      site(),
      report({ commentary: "Traffic is up 40%." }),
      PLATE,
    );
    expect(r.html).toContain("Traffic is up 40%.");
  });

  it("a commentary edit CHANGES the output — the preview is not a fixed artifact", async () => {
    const before = await renderReportFromRow(site(), report({ commentary: "first draft" }), PLATE);
    const after = await renderReportFromRow(site(), report({ commentary: "second draft" }), PLATE);
    expect(before.html).not.toBe(after.html);
    expect(after.html).toContain("second draft");
    expect(after.html).not.toContain("first draft");
  });

  it("honours subjectOverride, and falls back to the default subject", async () => {
    const overridden = await renderReportFromRow(
      site(),
      report({ subjectOverride: "A hand-written subject" }),
      PLATE,
    );
    expect(overridden.subject).toBe("A hand-written subject");
    const plain = await renderReportFromRow(site(), report(), PLATE);
    expect(plain.subject).not.toBe("A hand-written subject");
    expect(plain.subject).toContain("Acme Co");
  });

  it("returns the inline attachments the send needs, header included", async () => {
    const r = await renderReportFromRow(site(), report(), PLATE);
    expect(r.attachments.length).toBeGreaterThan(0);
    // `inlineContentId`, not `cid` — that is the Resend field name, and the
    // template references it as `cid:acme-co-header`.
    expect(r.attachments.some((a) => a.inlineContentId === "acme-co-header")).toBe(true);
    expect(r.html).toContain("cid:acme-co-header");
  });
});
