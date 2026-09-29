import { describe, it, expect, vi } from "vitest";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";
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
const { rerenderReport } = await import("../../../src/reports/send/rerender.js");

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

  it("drops a checklist row whose stored evidence is n/a (decision 17), keeping the rest", async () => {
    const r = await renderReportFromRow(
      site(),
      report({
        autoEvidence: {
          "Maint: CMS Checked": {
            result: "n/a",
            checkedAt: "2026-08-31T00:00:00Z",
            note: "no CMS",
          },
          "Maint: Uptime Checked": {
            result: "pass",
            checkedAt: "2026-08-31T00:00:00Z",
            note: "ok",
          },
        },
      }),
      PLATE,
    );
    expect(r.html).not.toContain("CMS Checked");
    expect(r.html).toContain("Uptime Checked");
    expect(r.html).toContain("Deploy &amp; Function Health");
  });

  it("a Testing send drops every n/a row, beside a fail and an unknown row that still render", async () => {
    const at = "2026-08-31T00:00:00Z";
    const r = await renderReportFromRow(
      site(),
      report({
        reportType: "Testing",
        autoEvidence: {
          "Maint: CMS Checked": { result: "n/a", checkedAt: at, note: "no CMS" },
          "Test: Form Functionality": { result: "n/a", checkedAt: at, note: "no form" },
          "Test: Verified After Updates": { result: "n/a", checkedAt: at, note: "no CI" },
          "Maint: Uptime Checked": { result: "fail", checkedAt: at, note: "down" },
          "Test: Mobile Browsers": { result: "unknown", checkedAt: at, note: "stale" },
        },
      }),
      PLATE,
    );
    for (const gone of ["CMS Checked", "Form Functionality", "Tested After Updates"]) {
      expect(r.html).not.toContain(gone);
    }
    expect(r.html).toContain("Uptime Checked");
    expect(r.html).toContain("Mobile Browsers");
  });

  it("a row with no stored evidence still renders", async () => {
    const r = await renderReportFromRow(site(), report({ autoEvidence: null }), PLATE);
    expect(r.html).toContain("CMS Checked");
  });
});

describe("refresh preview (rerender through renderReportFromRow)", () => {
  it("stores a body without the row the reticked evidence now calls n/a", async () => {
    const NOW = new Date("2026-09-28T12:00:00Z");
    const stamp = "2026-09-28T06:00:00Z";
    const noCms = site({
      functionHealthCheckedAt: stamp,
      cmsReachable: null,
      prismicModels: null,
      prismicModelsCheckedAt: stamp,
    });
    const stored: string[] = [];
    const r = await rerenderReport(
      {
        getReport: async () => report(),
        getSite: async () => noCms,
        loadHeaderPlate: async () => PLATE,
        render: (s, rep, plate) => renderReportFromRow(s, rep, plate),
        store: async (_id, html) => {
          stored.push(html);
        },
        storeEvidence: async () => true,
        now: () => NOW,
      },
      "recREP",
    );
    expect(r.status).toBe("rendered");
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toContain("CMS Checked");
    expect(stored[0]).toContain("Uptime Checked");
  });
});
