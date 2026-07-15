import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { PreparedHeader } from "../../src/reports/send/render-email.js";

// Mock the live GA/Search enrichment (no network in tests). Default: configured + returns data.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";
import { scoresFromRow, buildReportDataForSite } from "../../src/reports/report-data.js";

const HEADER: PreparedHeader = {
  bytes: new Uint8Array([1]),
  contentType: "image/jpeg",
  displayWidth: 600,
  displayHeight: 200,
  placeholderColor: "#eee",
};
const NOW = new Date("2026-06-26T12:00:00Z");

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec1",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    maintenanceFreq: "Monthly",
    testingFreq: "Monthly",
    ga4PropertyId: "123",
    searchQuery: "acme",
    reportRecipientsTo: null,
    headerImage: { url: "https://x/h.jpg", filename: "h.jpg", type: "image/jpeg" },
    pScore: 69,
    rScore: 100,
    bpScore: 100,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-06-20T00:00:00Z",
    ...over,
  } as WebsiteRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGaUsers).mockResolvedValue({
    value: { current: 280, previous: 275 },
    softFailed: false,
  });
  vi.mocked(fetchSearch).mockResolvedValue({
    value: { foundOnPage1: true, position: 3 },
    softFailed: false,
    defaultQueryMissed: false,
  });
});

describe("scoresFromRow", () => {
  it("returns the four scores, or null when any is missing", () => {
    expect(scoresFromRow(site())).toEqual({
      performance: 69,
      accessibility: 100,
      bestPractices: 100,
      seo: 100,
    });
    expect(scoresFromRow(site({ pScore: null }))).toBeNull();
  });
});

describe("buildReportDataForSite", () => {
  const scores = { performance: 69, accessibility: 100, bestPractices: 100, seo: 100 };

  it("announcement: GA window 30d + cadence/improvements + header dims", async () => {
    const d = await buildReportDataForSite(site(), "Announcement", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Announcement");
    expect(d.gaUsersCurrent).toBe(280);
    expect(d.gaPeriodDays).toBe(30);
    expect(d.searchPosition).toBe(3);
    expect(d.cadence).toEqual({ maintenance: "Monthly", testing: "Monthly" });
    expect(d.improvements).toEqual({ resendForms: true, svelte5: true });
    expect(d.headerWidth).toBe(600);
    expect(d.lastTestedDate).toBeNull(); // announcement has no last-tested line
  });

  it("maintenance: lastTestedDate from the row, GA window, no cadence/improvements", async () => {
    const d = await buildReportDataForSite(site(), "Maintenance", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Maintenance");
    expect(d.lastTestedDate).toEqual(new Date("2026-06-20T00:00:00Z"));
    expect(d.gaPeriodDays).toBe(30);
    expect(d.cadence).toBeUndefined();
    expect(d.improvements).toBeUndefined();
  });

  it("launch: no GA fetch at all (launch email shows no analytics)", async () => {
    const d = await buildReportDataForSite(site(), "Launch", NOW, { scores, header: HEADER });
    expect(d.reportType).toBe("Launch");
    expect(d.gaUsersCurrent).toBeUndefined();
    expect(fetchGaUsers).not.toHaveBeenCalled();
  });

  it("omits GA fields when enrichment is unavailable (null)", async () => {
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: false });
    vi.mocked(fetchSearch).mockResolvedValue({
      value: null,
      softFailed: false,
      defaultQueryMissed: false,
    });
    const d = await buildReportDataForSite(site(), "Maintenance", NOW, { scores, header: HEADER });
    expect(d.gaUsersCurrent).toBeUndefined();
    expect(d.searchPosition).toBeUndefined();
  });
});
