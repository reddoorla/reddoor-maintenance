import { describe, it, expect, beforeEach, vi } from "vitest";
import { runReportCommand } from "../../src/cli/commands/report.js";

// listWebsites + draftReportForSite are the IO the guard sits between; mock them so the
// test exercises ONLY the skip/draft decision, not GA/render/upload.
vi.mock("../../src/reports/airtable/websites.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/airtable/websites.js")>()),
  listWebsites: vi.fn(),
}));
vi.mock("../../src/reports/draft.js", () => ({ draftReportForSite: vi.fn() }));
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { draftReportForSite } from "../../src/reports/draft.js";
import { draftDueReports } from "../../src/cli/commands/report.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

beforeEach(() => {
  process.env.AIRTABLE_PAT = "";
  process.env.AIRTABLE_BASE_ID = "";
});

describe("runReportCommand", () => {
  it("throws a usage error when no slug, no --due, no --send-ready", async () => {
    await expect(runReportCommand(undefined, {})).rejects.toThrow(/Usage:/);
  });

  it("attaches exitCode=2 to the usage error", async () => {
    try {
      await runReportCommand(undefined, {});
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("requires AIRTABLE_PAT for --due", async () => {
    await expect(runReportCommand(undefined, { due: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for <slug>", async () => {
    await expect(runReportCommand("some-site", {})).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for <slug> --preview (still reads Airtable for scores)", async () => {
    await expect(runReportCommand("some-site", { preview: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for --send-ready", async () => {
    await expect(runReportCommand(undefined, { sendReady: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });
});

function siteRow(over = {}) {
  return {
    id: "rec_site_acme",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: null,
    ...over,
  } as unknown as Parameters<typeof draftReportForSite>[1];
}

const TODAY = new Date("2026-05-26T12:00:00Z");

describe("draftDueReports period guard", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    vi.mocked(listWebsites).mockReset();
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
  });

  it("drafts a due (site, type) when no Reports row exists for its period", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({ Reports: [] }); // no prior reports → due now, period = 2026-05
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    // The guard's search key is passed down as the stamped Period (idempotency invariant).
    expect(draftReportForSite).toHaveBeenCalledWith(base, expect.anything(), "Maintenance", {
      period: "2026-05",
    });
    expect(res.output).toMatch(/drafted/);
  });

  it("SKIPS a (site, type) already drafted for that period (idempotent re-run)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    // A row already exists for this site+type with Period = 2026-05 (the dueDate's YYYY-MM
    // when no prior Sent at → dueDate is today, 2026-05-26).
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_already",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
          },
        },
      ],
    });
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/skipped|already drafted/i);
    // Cron contract: a skip is not an error; exit 0 so the scheduler doesn't page.
    expect(res.code).toBe(0);
  });

  it("drafts a new period for a never-sent site whose stale draft is from an earlier month (intended: recurrence follows the due month, stale drafts stay pending)", async () => {
    // Semantic pin — this test documents INTENDED behaviour, not a regression fix.
    // A site with no prior sends and no maintenanceDay is due on TODAY (2026-05-26),
    // so its period key is 2026-05.  An existing draft for the PREVIOUS period (2026-04)
    // must NOT block the new draft — the guard keys on YYYY-MM, not just the existence
    // of any draft.  This path already works (different-period branch in draftDueReports);
    // the test exists to pin the semantics so a future refactor can't silently regress it.
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_stale",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-04", // previous month — must not block the 2026-05 draft
          },
        },
      ],
    });
    // TODAY = 2026-05-26, so dueDate = today, period = 2026-05
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(base, expect.anything(), "Maintenance", {
      period: "2026-05",
    });
    expect(res.code).toBe(0);
  });

  it("does NOT skip when an existing row is for a DIFFERENT period", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_old",
          fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-04" },
        },
      ],
    });
    await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
  });
});
