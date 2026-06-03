import { describe, it, expect, beforeEach, vi } from "vitest";
import { draftReportForSite } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";

// The GA client talks to Google over the network; mock it. readGaConfig is NOT mocked —
// it reads process.env, which the tests control (GA_SUBJECT set/unset).
vi.mock("../../src/reports/ga/client.js", () => ({ fetchPeriodUsers: vi.fn() }));
import { fetchPeriodUsers } from "../../src/reports/ga/client.js";

// The Search Console client also talks to Google over the network; mock it. Search
// presence reuses the GA service-account credentials, so the search branch runs whenever
// readGaConfig() is configured (GA_SUBJECT set) and the site has a searchQuery.
vi.mock("../../src/reports/search/client.js", () => ({ fetchSearchPresence: vi.fn() }));
import { fetchSearchPresence } from "../../src/reports/search/client.js";

// uploadAttachment in src/reports/airtable/attachments.ts uses fetch directly
// to talk to content.airtable.com. Stub global fetch in beforeEach so we don't
// hit the network.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  // Default GA OFF so the bulk of tests exercise the pre-GA behavior.
  delete process.env.GA_SUBJECT;
  delete process.env.GA_SA_KEY_PATH;
  vi.mocked(fetchPeriodUsers).mockReset();
  vi.mocked(fetchSearchPresence).mockReset();
});

function siteFixture(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "rec_site_acme",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "ops@acme.example.com",
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: "2026-04-26",
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
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    dashboardToken: null,
    ...over,
  };
}

describe("draftReportForSite", () => {
  it("throws with a clear error pointing at audit lighthouse when any score is null", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({ pScore: null });
    await expect(draftReportForSite(base, site, "Maintenance")).rejects.toThrow(
      /missing one or more Lighthouse scores/,
    );
    await expect(draftReportForSite(base, site, "Maintenance")).rejects.toThrow(/audit lighthouse/);
  });

  it("creates a Reports row with the snapshotted scores", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance");

    const creates = base.__calls.filter((c) => c.kind === "create");
    expect(creates).toHaveLength(1);
    const fields = creates[0]!.records[0]!.fields;
    expect(fields["Lighthouse — Performance"]).toBe(87);
    expect(fields["Lighthouse — Accessibility"]).toBe(91);
    expect(fields["Lighthouse — Best Practices"]).toBe(100);
    expect(fields["Lighthouse — SEO"]).toBe(95);
    expect(fields["Report type"]).toBe("Maintenance");
    expect(fields["Site"]).toEqual(["rec_site_acme"]);
  });

  it("sets Delivery status=pending in createDraft (not in stampSent — H4 fix)", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance");
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Delivery status"]).toBe("pending");
  });

  it("flips Draft ready=true after creating the row", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance");
    const updates = base.__calls.filter((c) => c.kind === "update");
    // There's one Airtable update (Draft ready). The HTML upload goes via fetch
    // (content.airtable.com), not through the SDK, so it doesn't show here.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.fields).toMatchObject({ "Draft ready": true });
  });

  it("uses testingDay as lastTestedDate for Maintenance reports", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({ testingDay: "2026-03-15" });
    await draftReportForSite(base, site, "Maintenance");
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Last tested date"]).toBe("2026-03-15");
  });

  it("does not set lastTestedDate on Testing reports", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({ testingDay: "2026-03-15", testingFreq: "Quarterly" });
    await draftReportForSite(base, site, "Testing");
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Last tested date"]).toBeUndefined();
  });

  it("formats Report ID as `{name} — {type} — {YYYY-MM-DD}`", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance");
    const reportId = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields["Report ID"];
    expect(reportId).toMatch(/^Acme Co — Maintenance — \d{4}-\d{2}-\d{2}$/);
  });

  it("writes a local preview file when previewOnly=true and never calls Airtable", async () => {
    const result = await draftReportForSite(null, siteFixture(), "Maintenance", {
      previewOnly: true,
      previewPath: "/tmp/draft-test-preview.html",
    });
    expect(result.reportRow).toBeNull();
    expect(result.htmlPath).toBe("/tmp/draft-test-preview.html");
    expect(result.html).toContain("Acme Co");
    const { unlink } = await import("node:fs/promises");
    await unlink("/tmp/draft-test-preview.html");
  });

  it("derives periodStart from the latest prior Reports row's periodEnd", async () => {
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_old",
          fields: {
            "Report ID": "Acme Co — Maintenance — 2026-04-26",
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            "Period end": "2026-04-26",
            "Sent at": "2026-04-26T10:00:00.000Z",
            "Delivery status": "delivered",
          },
        },
      ],
    });
    await draftReportForSite(base, siteFixture(), "Maintenance");
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period start"]).toBe("2026-04-26");
  });

  it("falls back to 30-days-ago for periodStart when no prior reports exist", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance");
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    const periodStart = fields["Period start"] as string;
    const periodEnd = fields["Period end"] as string;
    const diffMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  describe("GA enrichment", () => {
    it("writes GA users into the row when configured and the site has a property ID", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockResolvedValue({ current: 666, previous: 540 });
      const base = makeFakeBase({ Reports: [] });

      await draftReportForSite(base, siteFixture({ ga4PropertyId: "471880366" }), "Maintenance");

      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["GA users (period)"]).toBe(666);
      expect(fields["GA users (prev period)"]).toBe(540);
      // Queried the site's property.
      expect(vi.mocked(fetchPeriodUsers).mock.calls[0]![0].propertyId).toBe("471880366");
    });

    it("soft-fails: a GA error leaves the fields unwritten but still creates the draft", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockRejectedValue(new Error("7 PERMISSION_DENIED"));
      const base = makeFakeBase({ Reports: [] });

      const result = await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: "471880366" }),
        "Maintenance",
      );

      expect(result.reportRow).not.toBeNull(); // draft still created
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["GA users (period)"]).toBeUndefined();
      expect(fields["GA users (prev period)"]).toBeUndefined();
    });

    it("skips GA (never calls the API) when the site has no property ID", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      const base = makeFakeBase({ Reports: [] });

      await draftReportForSite(base, siteFixture({ ga4PropertyId: null }), "Maintenance");

      expect(fetchPeriodUsers).not.toHaveBeenCalled();
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["GA users (period)"]).toBeUndefined();
    });

    it("skips GA when GA_SUBJECT is unset even if the site has a property ID", async () => {
      const base = makeFakeBase({ Reports: [] });
      await draftReportForSite(base, siteFixture({ ga4PropertyId: "471880366" }), "Maintenance");
      expect(fetchPeriodUsers).not.toHaveBeenCalled();
    });
  });

  describe("search presence", () => {
    it("renders the rank and writes the search fields when found on page 1", async () => {
      // Search reuses the GA service-account creds, so the branch runs only when configured.
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({ foundOnPage1: true, position: 3 });
      const base = makeFakeBase({ Reports: [] });

      const result = await draftReportForSite(
        base,
        siteFixture({ searchQuery: "erp funds", searchConsoleProperty: null }),
        "Maintenance",
      );

      expect(result.html).toContain("Page 1 Google Result (#3)");
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["Search found page 1"]).toBe(true);
      expect(fields["Search position"]).toBe(3);
    });
  });
});
