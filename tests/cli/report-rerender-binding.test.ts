import { describe, it, expect, vi } from "vitest";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { ReportRow } from "../../src/reports/report-fields.js";

const SITE = makeWebsiteRow({
  id: "recSITE",
  name: "Acme Co",
  url: "https://acme.com",
  searchConsoleProperty: "https://acme.com/",
  pScore: 100,
  rScore: 100,
  bpScore: 100,
  seoScore: 100,
});
const GOOGLE = "Maint: Google Indexed";
const REPORT = {
  id: "report_X",
  reportId: "ACME-T",
  siteId: "recSITE",
  reportType: "Testing",
  periodStart: "2026-08-31",
  periodEnd: "2026-09-30",
  sentAt: null,
  approvedToSend: false,
  checklist: { [GOOGLE]: false },
  autoEvidence: { [GOOGLE]: { result: "unknown", checkedAt: null, note: "Not yet measured" } },
  searchFoundPage1: null,
  searchPosition: null,
  lighthouse: { performance: 100, accessibility: 100, bestPractices: 78, seo: 100 },
} as unknown as ReportRow;

vi.mock("../../src/db/client.js", () => ({
  openDb: async () => ({}),
  readDbConfig: () => ({ url: "libsql://fake" }),
}));
vi.mock("../../src/db/header-images.js", () => ({
  loadHeaderImage: async () => ({ bytes: new Uint8Array([1]) }),
}));
vi.mock("../../src/reports/send/render-from-row.js", () => ({
  renderReportFromRow: async () => ({ html: "<html></html>" }),
}));
vi.mock("../../src/db/fleet-state.js", () => ({
  getReportById: async () => REPORT,
  getSiteById: async () => SITE,
  storeRenderedHtml: async () => {},
  storeChecklistEvidence: vi.fn(async () => true),
  storeLighthouseScores: vi.fn(async () => true),
  mirrorHealthFields: vi.fn(async () => true),
}));
vi.mock("../../src/reports/draft.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/draft.js")>()),
  fetchSearch: vi.fn(async () => ({
    value: { foundOnPage1: true, position: 2, propertyFound: true },
    softFailed: false,
    notConfigured: false,
    lookup: { outcome: "resolved", property: "https://www.acme.com/" },
  })),
}));

import { runReportCommand } from "../../src/cli/commands/report.js";
import {
  mirrorHealthFields,
  storeChecklistEvidence,
  storeLighthouseScores,
} from "../../src/db/fleet-state.js";
import { fetchSearch } from "../../src/reports/draft.js";

describe("report --rerender binds the Google Indexed re-measure to the real IO", () => {
  it("measures with fetchSearch over the report's period and stores the search columns with the evidence", async () => {
    const out = await runReportCommand(undefined, { rerender: "report_X" });
    expect(out.code).toBe(0);
    expect(out.output).toContain("search=measured");

    const [site, start, end] = vi.mocked(fetchSearch).mock.calls[0]!;
    expect(site.id).toBe("recSITE");
    expect([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]).toEqual([
      "2026-08-31",
      "2026-09-30",
    ]);

    const call = vi.mocked(storeChecklistEvidence).mock.calls[0]!;
    expect(call[3][GOOGLE]!.result).toBe("pass");
    expect(call[4]).toEqual({ searchFoundPage1: true, searchPosition: 2 });
  });
});

describe("report --rerender binds the score refresh to the real IO (P1-34)", () => {
  it("stores the site row's current scores on the report it was asked to refresh", async () => {
    const out = await runReportCommand(undefined, { rerender: "report_X" });
    expect(out.output).toContain("scores=refreshed scores_change=bp:78→100");
    expect(vi.mocked(storeLighthouseScores).mock.calls.at(-1)).toEqual([
      {},
      "report_X",
      { performance: 100, accessibility: 100, bestPractices: 100, seo: 100 },
    ]);
  });
});

describe("report --rerender binds the Search Console lookup write-back to the real IO (P1-36)", () => {
  it("writes the lookup's three cells to the refreshed report's site", async () => {
    const out = await runReportCommand(undefined, { rerender: "report_X" });
    expect(out.output).toContain("lookup=resolved");
    const [db, siteId, fields] = vi.mocked(mirrorHealthFields).mock.calls.at(-1)!;
    expect(db).toEqual({});
    expect(siteId).toBe("recSITE");
    expect(fields).toMatchObject({
      "Search Console Outcome": "resolved",
      "Search Console Resolved": "https://www.acme.com/",
    });
    expect(typeof fields["Search Console Checked At"]).toBe("string");
  });
});
