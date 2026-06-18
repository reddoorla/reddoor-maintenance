import { describe, it, expect, beforeEach, vi } from "vitest";
import { runReportCommand, parseSingleSiteReportType } from "../../src/cli/commands/report.js";

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

  it("validates --type BEFORE touching Airtable (a bad type fails fast, no creds needed)", async () => {
    // The single-site path parses --type before openBase, so this rejects with the
    // type error — not AIRTABLE_PAT — even though no credentials are set.
    const p = runReportCommand("some-site", { type: "Launch" });
    await expect(p).rejects.toThrow(/launch <site>/);
    await expect(p).rejects.not.toThrow(/AIRTABLE_PAT/);
  });
});

describe("parseSingleSiteReportType", () => {
  it("defaults to Maintenance when unset or blank", () => {
    expect(parseSingleSiteReportType(undefined)).toBe("Maintenance");
    expect(parseSingleSiteReportType("   ")).toBe("Maintenance");
  });

  it("accepts Maintenance and Testing, case-insensitively", () => {
    expect(parseSingleSiteReportType("Testing")).toBe("Testing");
    expect(parseSingleSiteReportType("testing")).toBe("Testing");
    expect(parseSingleSiteReportType("MAINTENANCE")).toBe("Maintenance");
  });

  it("rejects Launch/Announcement, pointing at their own commands (exitCode 2)", () => {
    expect(() => parseSingleSiteReportType("Launch")).toThrow(/launch <site>/);
    expect(() => parseSingleSiteReportType("Announcement")).toThrow(/announce <site>/);
    try {
      parseSingleSiteReportType("Launch");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("rejects an unknown type (exitCode 2)", () => {
    expect(() => parseSingleSiteReportType("bogus")).toThrow(/Maintenance or Testing/);
    try {
      parseSingleSiteReportType("bogus");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
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
      queued: true,
      supersededIds: [],
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

  it("SKIPS a (site, type) already drafted-AND-READY for that period (idempotent re-run)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    // A READY row already exists for this site+type with Period = 2026-05 (the dueDate's
    // YYYY-MM when no prior Sent at → dueDate is today, 2026-05-26). Draft ready = true
    // means it's truly done → skip.
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_already",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
            "Draft ready": true,
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

  it("drafts a new period when the prior period's draft was SENT (recurrence follows the due month)", async () => {
    // Semantic pin — this test documents INTENDED behaviour, not a regression fix.
    // A site with a prior SENT report (period 2026-04) is now due again at TODAY
    // (2026-05-26), period key 2026-05. A SENT earlier-period draft must NOT block the
    // new draft — the guard keys on YYYY-MM, and the pile-up guard (Fix #2) only blocks
    // when the prior draft is still UNSENT.
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_prior_sent",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-04", // previous month, already sent — must not block 2026-05
            "Sent at": "2026-04-26T10:00:00.000Z",
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

  it("fetches reports with ONE unfiltered select — no per-site record-id formulas", async () => {
    // Linked-record fields ({Site}) render as primary-field NAMES in filterByFormula,
    // so a per-site `FIND(",recXXX,", ARRAYJOIN({Site}))` formula matches NOTHING against
    // the live base (live-proven). The fix is one fetch-all + client-side filtering —
    // which also kills the N+1 (one select for the whole fleet, not one per site).
    vi.mocked(listWebsites).mockResolvedValue([
      siteRow(),
      siteRow({ id: "rec_site_two", name: "Two Co" }),
    ]);
    const base = makeFakeBase({ Reports: [] });
    await draftDueReports(base, TODAY);
    const selects = base.__calls
      .filter((c) => c.kind === "select")
      .filter((c) => c.table === "Reports");
    expect(selects).toHaveLength(1);
    const formula = (selects[0]!.opts as { filterByFormula?: string }).filterByFormula ?? "";
    expect(formula).not.toContain("ARRAYJOIN");
    expect(formula).not.toMatch(/rec_site/);
  });

  it("does NOT skip (same-period) when an existing SENT row is for a DIFFERENT period", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_old",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-04",
            // SENT so the pile-up guard (Fix #2) doesn't block — this test pins the
            // SAME-period skip's period sensitivity, not the pending-pile-up rule.
            "Sent at": "2026-04-26T10:00:00.000Z",
          },
        },
      ],
    });
    await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
  });

  it("COMPLETES a half-made (not-ready) row for this period instead of skipping (Fix #1)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    // A row exists for THIS period (2026-05) but Draft ready is false — a crash
    // between createDraft and setDraftReady. It must be completed in place, not
    // skipped forever (skip → never sendable, since listSendable needs Draft ready).
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_halfmade",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
            // no "Draft ready" → mapRow → draftReady false
          },
        },
      ],
    });
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    // Completed via the completeRowId path against the EXISTING row id — no createDraft.
    expect(draftReportForSite).toHaveBeenCalledWith(
      base,
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05", completeRowId: "rec_halfmade" }),
    );
    expect(res.output).toMatch(/completed half-made draft/i);
    expect(res.code).toBe(0);
  });

  it("does NOT create a NEW-period draft while an EARLIER-period draft is unsent (pile-up guard, Fix #2)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    // Site is due now (2026-05) but already has an UNSENT 2026-04 draft pending
    // approval. Don't accrue another — skip the new-period draft.
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_pending",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-04",
            "Draft ready": true, // ready but never approved/sent (sentAt null)
          },
        },
      ],
    });
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/already has an unsent 2026-04 draft pending approval/i);
    expect(res.code).toBe(0);
  });

  it("DOES create the new-period draft once the earlier pending draft has been sent (Fix #2 boundary)", async () => {
    vi.mocked(listWebsites).mockResolvedValue([siteRow()]);
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_prior",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-04",
            "Draft ready": true,
            "Sent at": "2026-04-26T10:00:00.000Z", // sent → no longer pending
          },
        },
      ],
    });
    const res = await draftDueReports(base, TODAY);
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(base, expect.anything(), "Maintenance", {
      period: "2026-05",
    });
    expect(res.code).toBe(0);
  });
});
