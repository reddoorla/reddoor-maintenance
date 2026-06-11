import { describe, it, expect, vi, beforeEach } from "vitest";

// runDueDraft wires together Airtable reads + per-site drafting. Mock the whole
// data layer so we can drive the *summary* behavior: a fleet-wide GA/Search
// outage must be visible in the batch summary, not buried in per-site warnings.
vi.mock("../../src/reports/airtable/client.js", () => ({
  readAirtableConfig: () => ({ pat: "pat", baseId: "base" }),
  openBase: () => ({}),
}));
vi.mock("../../src/reports/airtable/websites.js", () => ({
  listWebsites: async () => [
    { id: "recA", name: "Site A" },
    { id: "recB", name: "Site B" },
  ],
  siteSlug: (n: string) => n,
}));
vi.mock("../../src/reports/airtable/reports.js", () => ({
  listAllReports: async () => [],
}));
vi.mock("../../src/reports/due.js", () => ({
  findDueReports: () => [
    {
      site: { id: "recA", name: "Site A" },
      reportType: "Maintenance",
      dueDate: new Date("2026-06-09T12:00:00Z"),
    },
    {
      site: { id: "recB", name: "Site B" },
      reportType: "Maintenance",
      dueDate: new Date("2026-06-09T12:00:00Z"),
    },
  ],
  reportPeriodKey: () => "2026-06",
}));
vi.mock("../../src/reports/draft.js", () => ({ draftReportForSite: vi.fn() }));

import { runReportCommand } from "../../src/cli/commands/report.js";
import { draftReportForSite } from "../../src/reports/draft.js";

const draftMock = vi.mocked(draftReportForSite);

function draftResult(reportId: string, softFailures: Array<"ga" | "search"> = []) {
  return {
    reportRow: { reportId } as never,
    htmlPath: null,
    html: "",
    softFailures,
  };
}

beforeEach(() => {
  draftMock.mockReset();
});

describe("report --due summary", () => {
  it("appends a soft-failure summary line counting sites whose GA/Search enrichment errored", async () => {
    draftMock
      .mockResolvedValueOnce(draftResult("A — Maintenance — 2026-06-09", ["ga", "search"]))
      .mockResolvedValueOnce(draftResult("B — Maintenance — 2026-06-09", ["ga"]));

    const { output, code } = await runReportCommand(undefined, { due: true });

    // Both sites still drafted (soft-fail is non-fatal) → exit 0.
    expect(output).toMatch(/✓ drafted: A/);
    expect(output).toMatch(/✓ drafted: B/);
    expect(code).toBe(0);
    // One trailing warning, counting SITES not failures (A had 2, still one site).
    expect(output).toMatch(/⚠ 2 sites had GA\/Search/);
  });

  it("omits the summary line when no site soft-failed", async () => {
    draftMock
      .mockResolvedValueOnce(draftResult("A — Maintenance — 2026-06-09", []))
      .mockResolvedValueOnce(draftResult("B — Maintenance — 2026-06-09", []));

    const { output, code } = await runReportCommand(undefined, { due: true });

    expect(code).toBe(0);
    expect(output).not.toContain("⚠");
  });
});
