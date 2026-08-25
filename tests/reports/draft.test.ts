import { describe, it, expect, beforeEach, vi } from "vitest";
import { draftReportForSite, fetchSearch } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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
  return makeWebsiteRow({
    id: "rec_site_acme",
    pointOfContact: "ops@acme.example.com",
    maintenanceFreq: "Monthly",
    maintenanceDay: "2026-04-26",
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    ...over,
  });
}

/** Every case below passes a fake base, which opens the draft-time header refresh —
 *  a real chromium launch and DNS lookup per case (the refresh swallows its own
 *  errors, so it would fail invisibly and just cost seconds). Opt out so this stays
 *  a unit suite. Production leaves `refreshHeader` unset and gets the real refresh;
 *  `draft-header-image.test.ts` covers refreshHeaderImage itself. */
const NO_HEADER = { refreshHeader: false } as const;

describe("draftReportForSite", () => {
  it("throws with a clear error pointing at audit lighthouse when any score is null", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({ pScore: null });
    await expect(draftReportForSite(base, site, "Maintenance", NO_HEADER)).rejects.toThrow(
      /missing one or more Lighthouse scores/,
    );
    await expect(draftReportForSite(base, site, "Maintenance", NO_HEADER)).rejects.toThrow(
      /audit lighthouse/,
    );
  });

  it("creates a Reports row with the snapshotted scores", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);

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
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Delivery status"]).toBe("pending");
  });

  it("flips Draft ready=true after creating the row", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const updates = base.__calls.filter((c) => c.kind === "update");
    // There's one Airtable update (Draft ready). The HTML upload goes via fetch
    // (content.airtable.com), not through the SDK, so it doesn't show here.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.records[0]!.fields).toMatchObject({ "Draft ready": true });
  });

  it("uses the live Lighthouse-audit timestamp (not testingDay) as lastTestedDate for Maintenance", async () => {
    const base = makeFakeBase({ Reports: [] });
    // lastLighthouseAuditAt is a full ISO timestamp (stamped by the audit run); the stored
    // "Last tested date" is its UTC calendar day. testingDay is set to a DIFFERENT, stale value
    // to prove the email no longer reads the scheduling anchor.
    const site = siteFixture({
      lastLighthouseAuditAt: "2026-03-15T09:30:00.000Z",
      testingDay: "2020-01-01",
    });
    await draftReportForSite(base, site, "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Last tested date"]).toBe("2026-03-15");
  });

  it("does not set lastTestedDate on Testing reports (Maintenance-only)", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({
      lastLighthouseAuditAt: "2026-03-15T09:30:00.000Z",
      testingFreq: "Quarterly",
    });
    await draftReportForSite(base, site, "Testing", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Last tested date"]).toBeUndefined();
  });

  it("leaves lastTestedDate unset when the site has never been audited", async () => {
    const base = makeFakeBase({ Reports: [] });
    const site = siteFixture({ lastLighthouseAuditAt: null });
    await draftReportForSite(base, site, "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Last tested date"]).toBeUndefined();
  });

  it("formats Report ID as `{name} — {type} — {YYYY-MM-DD}`", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const reportId = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields["Report ID"];
    expect(reportId).toMatch(/^Acme Co — Maintenance — \d{4}-\d{2}-\d{2}$/);
  });

  it("writes a local preview file when previewOnly=true and never calls Airtable", async () => {
    // A unique per-run dir under os.tmpdir() — a hardcoded /tmp path isn't
    // parallel-safe and is unwritable in sandboxed runners.
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "draft-test-"));
    const previewPath = join(dir, "draft-test-preview.html");
    try {
      const result = await draftReportForSite(null, siteFixture(), "Maintenance", {
        previewOnly: true,
        previewPath,
      });
      expect(result.reportRow).toBeNull();
      expect(result.htmlPath).toBe(previewPath);
      expect(result.html).toContain("Acme Co");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // `base === null` used to mean BOTH "never write to Airtable" and "do no IO at all",
  // so a preview could never contain an ANALYTICS section however good the credentials
  // were. A CI job built to prove the GA secrets on top of `--preview` therefore failed
  // 100% of the time and reported it as a credential outage (2026-08-12). These two cases
  // pin the split: writing and enriching are now independent.
  describe("preview enrichment (writes vs IO are separate concerns)", () => {
    async function withTempPreview(fn: (previewPath: string) => Promise<void>) {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = await mkdtemp(join(tmpdir(), "draft-enrich-"));
      try {
        await fn(join(dir, "preview.html"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    it("previewOnly does NO enrichment by default — the fast no-IO render path", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockResolvedValue({ current: 666, previous: 540 });
      await withTempPreview(async (previewPath) => {
        const result = await draftReportForSite(
          null,
          siteFixture({ ga4PropertyId: "471880366" }),
          "Maintenance",
          { previewOnly: true, previewPath },
        );
        expect(fetchPeriodUsers).not.toHaveBeenCalled();
        expect(result.reportRow).toBeNull();
      });
    });

    it("previewOnly + enrich fetches GA and renders ANALYTICS, still writing nothing", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockResolvedValue({ current: 666, previous: 540 });
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
      await withTempPreview(async (previewPath) => {
        const result = await draftReportForSite(
          null,
          siteFixture({ ga4PropertyId: "471880366" }),
          "Maintenance",
          { previewOnly: true, enrich: true, previewPath },
        );
        expect(vi.mocked(fetchPeriodUsers).mock.calls[0]![0].propertyId).toBe("471880366");
        // The rendered HTML is what the CI credential proof greps for.
        expect(result.html).toContain(">ANALYTICS<");
        // Enriching must not have turned this into a writing path.
        expect(result.reportRow).toBeNull();
        expect(result.htmlPath).toBe(previewPath);
      });
    });
  });

  it("derives periodStart as the day AFTER the latest prior report's periodEnd (half-open)", async () => {
    // The prior report already covered through its periodEnd inclusively, so this
    // report starts the next day. Without the +1 the boundary day (here 2026-04-26)
    // is double-counted in both reports' inclusive GA/Search windows.
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
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period start"]).toBe("2026-04-27");
  });

  it("falls back to 30-days-ago for periodStart when no prior reports exist", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    const periodStart = fields["Period start"] as string;
    const periodEnd = fields["Period end"] as string;
    const diffMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });

  it("stamps Period with an explicitly passed period key (the dueDate's YYYY-MM)", async () => {
    // CRITICAL idempotency invariant: the stamped Period MUST equal the key the
    // draftDueReports guard searches by — reportPeriodKey(dueDate) — NOT the run
    // month. If the cron lags into the month after the dueDate month, a run-month
    // stamp would never match the guard's search key and every later run would
    // draft a duplicate. So the caller passes the key down explicitly.
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", {
      period: "2026-05",
      ...NO_HEADER,
    });
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period"]).toBe("2026-05");
  });

  it("falls back to the periodEnd's YYYY-MM when no period is passed (manual one-off draft)", async () => {
    const base = makeFakeBase({ Reports: [] });
    await draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    // Period field must be derived from periodEnd's YYYY-MM (not just match the shape).
    // This pins the fallback's *source*, not merely its format.
    expect(fields["Period"]).toBe((fields["Period end"] as string).slice(0, 7));
  });

  describe("complete an existing (half-made) row — Fix #1", () => {
    it("re-attaches HTML + flips Draft ready on the EXISTING row, with NO second createDraft", async () => {
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(base, siteFixture(), "Maintenance", {
        ...NO_HEADER,
        period: "2026-05",
        completeRowId: "rec_halfmade",
        existingRow: {
          id: "rec_halfmade",
          reportId: "Acme Co — Maintenance — 2026-05-26",
        } as never,
      });

      // No createDraft on the complete path — that would duplicate the period.
      expect(base.__calls.filter((c) => c.kind === "create")).toHaveLength(0);
      // setDraftReady runs against the EXISTING row id (the missing ready flag).
      const updates = base.__calls.filter((c) => c.kind === "update");
      expect(updates).toHaveLength(1);
      expect(updates[0]!.records[0]!.id).toBe("rec_halfmade");
      expect(updates[0]!.records[0]!.fields).toMatchObject({ "Draft ready": true });
      // The HTML attachment is re-uploaded (the missing attachment) — goes via fetch.
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchUrl = vi.mocked(global.fetch).mock.calls[0]![0] as string;
      expect(fetchUrl).toContain("/rec_halfmade/");
      expect(fetchUrl).toContain("uploadAttachment");
      // reportRow comes back as the existing row so callers keep the same shape.
      expect(result.reportRow?.id).toBe("rec_halfmade");
    });
  });

  describe("GA enrichment", () => {
    // These cases assert only on GA fields, but a GA-enrolled site (ga4PropertyId set) now also
    // traverses the search branch with the site-name default. Give the search client a faithful
    // production-shaped no-data response so that branch exercises a clean miss (defaultQueryMissed,
    // no soft-fail) rather than throwing on an unmocked `undefined.position`. The search-specific
    // and fetchSearch describe blocks below keep their own explicit mocks.
    beforeEach(() => {
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
    });

    it("writes GA users into the row when configured and the site has a property ID", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockResolvedValue({ current: 666, previous: 540 });
      const base = makeFakeBase({ Reports: [] });

      await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: "471880366" }),
        "Maintenance",
        NO_HEADER,
      );

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
        NO_HEADER,
      );

      expect(result.reportRow).not.toBeNull(); // draft still created
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["GA users (period)"]).toBeUndefined();
      expect(fields["GA users (prev period)"]).toBeUndefined();
    });

    it("skips GA (never calls the API) when the site has no property ID", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      const base = makeFakeBase({ Reports: [] });

      await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: null }),
        "Maintenance",
        NO_HEADER,
      );

      expect(fetchPeriodUsers).not.toHaveBeenCalled();
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["GA users (period)"]).toBeUndefined();
    });

    it("skips GA when GA_SUBJECT is unset even if the site has a property ID", async () => {
      const base = makeFakeBase({ Reports: [] });
      await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: "471880366" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(fetchPeriodUsers).not.toHaveBeenCalled();
    });

    it("flags a 'ga' soft-failure when GA is configured but the API errors", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchPeriodUsers).mockRejectedValue(new Error("7 PERMISSION_DENIED"));
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: "471880366" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(result.softFailures).toContain("ga");
    });

    it("records NO soft-failure when GA is simply not configured (a legitimate skip, not an outage)", async () => {
      // GA_SUBJECT unset in beforeEach → readGaConfig null → skip. A skip must not
      // count as a soft-failure, or every un-instrumented site would trip the
      // fleet-scale outage warning.
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(
        base,
        siteFixture({ ga4PropertyId: "471880366" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(result.softFailures).toEqual([]);
    });
  });

  describe("search presence", () => {
    it("renders the rank and writes the search fields when found on page 1", async () => {
      // Search reuses the GA service-account creds, so the branch runs only when configured.
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      const base = makeFakeBase({ Reports: [] });

      const result = await draftReportForSite(
        base,
        siteFixture({ searchQuery: "erp funds", searchConsoleProperty: null }),
        "Maintenance",
        NO_HEADER,
      );

      expect(result.html).toContain("Page 1 Google Result (#3)");
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["Search found page 1"]).toBe(true);
      expect(fields["Search position"]).toBe(3);
    });

    it("flags a 'search' soft-failure when the Search API errors", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockRejectedValue(new Error("backend error"));
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(
        base,
        siteFixture({ searchQuery: "erp funds" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(result.softFailures).toContain("search");
    });

    it("surfaces searchDefaultMissed on the DraftResult when the site-name default finds nothing", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      // No explicit searchQuery, but GA-enrolled → search runs with the site name as the
      // default query. position:null means the name matched nothing in Search Console.
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(
        base,
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(result.searchDefaultMissed).toBe(true);
    });

    it("leaves searchDefaultMissed false when an explicit query finds nothing", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
      const base = makeFakeBase({ Reports: [] });
      const result = await draftReportForSite(
        base,
        siteFixture({ searchQuery: "erp funds" }),
        "Maintenance",
        NO_HEADER,
      );
      expect(result.searchDefaultMissed).toBe(false);
    });
  });

  describe("fetchSearch — default query + name-default miss flag", () => {
    const period = { start: new Date("2026-05-01"), end: new Date("2026-05-31") };
    const lastQuery = () => vi.mocked(fetchSearchPresence).mock.calls[0]![0].query;

    it("passes an explicit searchQuery verbatim and does not flag a default miss", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: "erp funds", ga4PropertyId: null }),
        period.start,
        period.end,
      );
      expect(lastQuery()).toBe("erp funds");
      expect(res.defaultQueryMissed).toBe(false);
    });

    it("defaults the query to the site name when searchQuery is empty but GA is enrolled", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(lastQuery()).toBe("Acme Co");
    });

    it("treats a whitespace-only searchQuery as empty and falls back to the site name", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      await fetchSearch(
        siteFixture({ searchQuery: "   ", ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(lastQuery()).toBe("Acme Co");
    });

    it("skips search (never calls the API) when the site has neither a query nor a GA property", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: null }),
        period.start,
        period.end,
      );
      expect(fetchSearchPresence).not.toHaveBeenCalled();
      expect(res.value).toBeNull();
      expect(res.softFailed).toBe(false);
      expect(res.defaultQueryMissed).toBe(false);
      // Nothing to measure on an un-enrolled site — that is not an environment gap.
      expect(res.notConfigured).toBe(false);
    });

    it("flags notConfigured when the site IS enrolled but no GA/SC credentials exist here", async () => {
      // GA_SUBJECT unset → readGaConfig() null. Pre-fix this was indistinguishable from the
      // un-enrolled skip above, so a CI run with no credentials silently dropped the check.
      delete process.env.GA_SUBJECT;
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(fetchSearchPresence).not.toHaveBeenCalled();
      expect(res.value).toBeNull();
      // Still not a soft-failure — the API never errored; the environment is just unwired.
      expect(res.softFailed).toBe(false);
      expect(res.notConfigured).toBe(true);
    });

    it("leaves notConfigured false when credentials are present", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: "erp funds" }),
        period.start,
        period.end,
      );
      expect(res.notConfigured).toBe(false);
    });

    it("flags defaultQueryMissed when the site-name default returns position:null", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(res.defaultQueryMissed).toBe(true);
    });

    it("does NOT flag defaultQueryMissed when the site-name default finds a position", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 3,
        propertyFound: true,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(res.defaultQueryMissed).toBe(false);
    });

    it("does NOT flag defaultQueryMissed when an EXPLICIT query returns position:null", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: true,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: "erp funds", ga4PropertyId: null }),
        period.start,
        period.end,
      );
      expect(res.defaultQueryMissed).toBe(false);
      expect(res.propertyMissing).toBe(false);
    });

    it("flags propertyMissing (NOT defaultQueryMissed) when NO property resolved — name-default query", async () => {
      // Pre-split, this case raised defaultQueryMissed whose "set an explicit Search
      // query" remedy can't fix a missing property — and following it silenced the
      // signal permanently (see the next test's pre-fix behavior).
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: false,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(res.propertyMissing).toBe(true);
      expect(res.defaultQueryMissed).toBe(false);
    });

    it("flags propertyMissing even for an EXPLICIT query (the case the old flag permanently silenced)", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: null,
        propertyFound: false,
      });
      const res = await fetchSearch(
        siteFixture({ searchQuery: "acme co los angeles", ga4PropertyId: null }),
        period.start,
        period.end,
      );
      expect(res.propertyMissing).toBe(true);
      expect(res.defaultQueryMissed).toBe(false);
    });

    it("propertyMissing stays false on the soft-fail (API error) path", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockRejectedValue(new Error("api down"));
      const res = await fetchSearch(
        siteFixture({ searchQuery: null, ga4PropertyId: "471880366" }),
        period.start,
        period.end,
      );
      expect(res.softFailed).toBe(true);
      expect(res.propertyMissing).toBe(false);
      expect(res.defaultQueryMissed).toBe(false);
    });
  });

  describe("checklist auto-tick", () => {
    it("auto-ticks Google Indexed + snapshots evidence when Search Console shows page 1", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: true,
        position: 2,
        propertyFound: true,
      });
      const base = makeFakeBase({ Reports: [] });
      await draftReportForSite(
        base,
        siteFixture({ searchQuery: "acme co" }),
        "Maintenance",
        NO_HEADER,
      );
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["Maint: Google Indexed"]).toBe(true);
      const ev = JSON.parse(fields["Checklist auto-evidence"] as string);
      expect(ev["Maint: Google Indexed"].result).toBe("pass");
    });

    it("does NOT auto-tick Google Indexed when not on page 1", async () => {
      process.env.GA_SUBJECT = "tucker@reddoorla.com";
      vi.mocked(fetchSearchPresence).mockResolvedValue({
        foundOnPage1: false,
        position: 22,
        propertyFound: true,
      });
      const base = makeFakeBase({ Reports: [] });
      await draftReportForSite(
        base,
        siteFixture({ searchQuery: "acme co" }),
        "Maintenance",
        NO_HEADER,
      );
      const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
      expect(fields["Maint: Google Indexed"]).toBeUndefined();
    });
  });
});

/**
 * #539 Phase 5: the create-side dual-write. `draftReportForSite` is the ONE
 * place the nightly path creates a Reports row, so the mirror is threaded
 * through its options and handed to `createDraft` — the mirror is deliberately
 * NOT defaulted here, because a default would open a real libSQL handle from
 * inside a unit suite whenever a developer happens to have TURSO_* exported.
 * Wiring lives at the composition roots (report.ts), pinned by its own test.
 */
describe("draftReportForSite → the Turso create mirror", () => {
  it("hands the created record to options.reportMirror", async () => {
    const base = makeFakeBase({ Reports: [] });
    const seen: Array<{ id: string; fields: Record<string, unknown> }> = [];

    const result = await draftReportForSite(base, siteFixture(), "Maintenance", {
      ...NO_HEADER,
      reportMirror: {
        created: async (rec: { id: string; fields: Record<string, unknown> }) => {
          seen.push(rec);
        },
        body: async () => {},
        patch: async () => {},
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(result.reportRow!.id);
    expect(seen[0]!.fields["Report type"]).toBe("Maintenance");
  });

  it("stores the rendered body in Turso, where the console preview reads it", async () => {
    // The row alone is not enough: /api/reports/:id/preview serves
    // `reports.rendered_html`, so a mirrored row with no body renders "No
    // rendered body stored for this report." until the next hourly sync
    // re-downloads the very attachment we just uploaded.
    const base = makeFakeBase({ Reports: [] });
    const bodies: Array<{ id: string; html: string }> = [];

    const result = await draftReportForSite(base, siteFixture(), "Maintenance", {
      ...NO_HEADER,
      reportMirror: {
        created: async () => {},
        body: async (id, html) => {
          bodies.push({ id, html });
        },
        patch: async () => {},
      },
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.id).toBe(result.reportRow!.id);
    expect(bodies[0]!.html).toBe(result.html);
  });

  it("mirrors the queue flag, so a fresh draft reads as queued in Turso", async () => {
    const base = makeFakeBase({ Reports: [] });
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];

    const result = await draftReportForSite(base, siteFixture(), "Maintenance", {
      ...NO_HEADER,
      reportMirror: {
        created: async () => {},
        body: async () => {},
        patch: async (id, patch) => {
          patched.push({ id, patch: patch as Record<string, unknown> });
        },
      },
    });

    expect(patched).toEqual([{ id: result.reportRow!.id, patch: { draft_ready: 1 } }]);
  });

  it("drafts exactly as before when no mirror is supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await expect(
      draftReportForSite(base, siteFixture(), "Maintenance", NO_HEADER),
    ).resolves.toMatchObject({ queued: true });
  });
});
