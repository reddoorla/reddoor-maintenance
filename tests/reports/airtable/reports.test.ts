import { describe, it, expect } from "vitest";

import {
  REPORTS_TABLE,
  escapeFormulaString,
  createDraft,
  findReportByPeriod,
  listAllReports,
  listReportsForSite,
  toReportType,
} from "../../../src/reports/airtable/reports.js";
import { WEBSITES_TABLE, siteSlug } from "../../../src/reports/airtable/websites.js";
import { makeFakeBase } from "../_helpers/fake-airtable-base.js";

describe("airtable constants", () => {
  it("uses the exact Airtable table names", () => {
    expect(REPORTS_TABLE).toBe("Reports");
    expect(WEBSITES_TABLE).toBe("Websites");
  });
});

describe("siteSlug", () => {
  it("lowercases and dasherizes the site name", () => {
    expect(siteSlug("Med Solutions of Texas")).toBe("med-solutions-of-texas");
  });
  it("strips leading/trailing separators", () => {
    expect(siteSlug("  Acme & Co.  ")).toBe("acme-co");
  });
  it("collapses runs of separators", () => {
    expect(siteSlug("Foo --- Bar")).toBe("foo-bar");
  });
});

describe("escapeFormulaString", () => {
  it("leaves clean ids alone", () => {
    expect(escapeFormulaString("recABCDEF000001")).toBe("recABCDEF000001");
    expect(escapeFormulaString("msg_abc123")).toBe("msg_abc123");
  });
  it("escapes double quotes", () => {
    expect(escapeFormulaString('hello "world"')).toBe('hello \\"world\\"');
  });
  it("escapes backslashes (before quotes, so escaped quotes don't double-escape)", () => {
    expect(escapeFormulaString("path\\to\\thing")).toBe("path\\\\to\\\\thing");
  });
  it("handles mixed quotes and backslashes", () => {
    expect(escapeFormulaString('a\\"b')).toBe('a\\\\\\"b');
  });
});

describe("createDraft Period field", () => {
  const baseInput = {
    reportId: "Acme — Maintenance — 2026-05-26",
    siteId: "rec_site_acme",
    reportType: "Maintenance" as const,
    periodStart: new Date("2026-04-27T00:00:00Z"),
    periodEnd: new Date("2026-05-26T00:00:00Z"),
    completedOn: new Date("2026-05-26T00:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    lastTestedDate: null,
  };

  it("writes the Period field when supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, { ...baseInput, period: "2026-05" });
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period"]).toBe("2026-05");
  });

  it("omits the Period field when not supplied (back-compat)", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, baseInput);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Period"]).toBeUndefined();
  });

  it("maps the Period field back onto the row", async () => {
    const base = makeFakeBase({ Reports: [] });
    const row = await createDraft(base, { ...baseInput, period: "2026-05" });
    expect(row.period).toBe("2026-05");
  });

  it("writes the Subject override field when supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, { ...baseInput, subjectOverride: "Hello" });
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields["Subject override"]).toBe("Hello");
  });

  it("omits the Subject override field when not supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, baseInput);
    const fields = base.__calls.find((c) => c.kind === "create")!.records[0]!.fields;
    expect(fields).not.toHaveProperty("Subject override");
  });
});

describe("toReportType", () => {
  it("round-trips Announcement", () => {
    expect(toReportType("Announcement")).toBe("Announcement");
  });
});

describe("listAllReports / listReportsForSite", () => {
  // Two rows, two different sites. The fake does NOT evaluate filterByFormula, so
  // any site-scoping the production code does must happen CLIENT-side to show up here.
  const seed = {
    Reports: [
      {
        id: "rec_r_acme",
        fields: { "Report ID": "A", Site: ["rec_site_acme"], "Report type": "Maintenance" },
      },
      {
        id: "rec_r_other",
        fields: { "Report ID": "B", Site: ["rec_site_other"], "Report type": "Maintenance" },
      },
    ],
  };

  it("listAllReports fetches every row with no record-id filterByFormula", async () => {
    const base = makeFakeBase(seed);
    const rows = await listAllReports(base);
    expect(rows.map((r) => r.id)).toEqual(["rec_r_acme", "rec_r_other"]);
    const select = base.__calls.find((c) => c.kind === "select")!;
    const formula = (select.opts as { filterByFormula?: string }).filterByFormula ?? "";
    // Linked-record fields render as primary-field NAMES in formulas, so a record-id
    // filter can never match — the query must not attempt one.
    expect(formula).not.toContain("ARRAYJOIN");
    expect(formula).not.toMatch(/\brec/);
  });

  it("listReportsForSite filters client-side by siteId, never via a record-id formula", async () => {
    const base = makeFakeBase(seed);
    const rows = await listReportsForSite(base, "rec_site_acme");
    expect(rows.map((r) => r.id)).toEqual(["rec_r_acme"]);
    for (const call of base.__calls.filter((c) => c.kind === "select")) {
      const formula = (call.opts as { filterByFormula?: string }).filterByFormula ?? "";
      expect(formula).not.toContain("ARRAYJOIN");
      expect(formula).not.toContain("rec_site_acme");
    }
  });

  it("maps a known Report type through, and an UNKNOWN single-select option to Maintenance", async () => {
    const base = makeFakeBase({
      Reports: [
        { id: "rec_launch", fields: { "Report ID": "L", "Report type": "Launch" } },
        { id: "rec_bogus", fields: { "Report ID": "Q", "Report type": "Quarterly" } },
        { id: "rec_blank", fields: { "Report ID": "Z" } },
      ],
    });
    const byId = Object.fromEntries((await listAllReports(base)).map((r) => [r.id, r.reportType]));
    expect(byId["rec_launch"]).toBe("Launch");
    // An unexpected option must NOT slip through and silently mis-template the email.
    expect(byId["rec_bogus"]).toBe("Maintenance");
    expect(byId["rec_blank"]).toBe("Maintenance");
  });
});

describe("mapRow checklist", () => {
  it("reads the 12 checkbox cells into row.checklist; true cells true, absent cells false", async () => {
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_checklist",
          fields: {
            "Report ID": "C",
            "Report type": "Maintenance",
            "Maint: Reviewed Logs": true,
            "Maint: DNS Checked": true,
            // The other 10 cells are absent → must read false.
          },
        },
      ],
    });
    const row = (await listAllReports(base))[0]!;
    expect(row.checklist["Maint: Reviewed Logs"]).toBe(true);
    expect(row.checklist["Maint: DNS Checked"]).toBe(true);
    // Absent cells default to false (legacy rows created before the fields existed).
    expect(row.checklist["Maint: CMS Checked"]).toBe(false);
    expect(row.checklist["Maint: Google Indexed"]).toBe(false);
    expect(row.checklist["Test: Desktop Browsers"]).toBe(false);
    // All 12 keys are present.
    expect(Object.keys(row.checklist)).toHaveLength(12);
  });
});

describe("findReportByPeriod", () => {
  it("filters server-side on Report type + Period only, matching the site client-side", async () => {
    // The fake base does NOT evaluate filterByFormula — it returns ALL seeded rows.
    // Seeding a same-type/same-period row for a DIFFERENT site therefore proves the
    // client-side siteId match does real work: only it can keep rec_wrong_site out.
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_wrong_site",
          fields: { Site: ["rec_site_other"], "Report type": "Maintenance", Period: "2026-05" },
        },
        {
          id: "rec_existing",
          fields: {
            "Report ID": "Acme — Maintenance — 2026-05-26",
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
          },
        },
      ],
    });

    const row = await findReportByPeriod(base, "rec_site_acme", "Maintenance", "2026-05");

    expect(row?.id).toBe("rec_existing");
    expect(row?.period).toBe("2026-05");

    const select = base.__calls.find((c) => c.kind === "select")!;
    const formula = (select.opts as { filterByFormula: string }).filterByFormula;
    expect(formula).toContain('{Report type} = "Maintenance"');
    expect(formula).toContain('{Period} = "2026-05"');
    // {Site} renders as linked-row NAMES in formulas, never record ids — the formula
    // must not mention the site at all (live-proven: an id comparison matches nothing).
    expect(formula).not.toContain("ARRAYJOIN");
    expect(formula).not.toContain("{Site}");
    expect(formula).not.toContain("rec_site_acme");
  });

  it("returns null when the only same-type/same-period row belongs to a DIFFERENT site", async () => {
    const base = makeFakeBase({
      Reports: [
        {
          id: "rec_wrong_site",
          fields: { Site: ["rec_site_other"], "Report type": "Maintenance", Period: "2026-05" },
        },
      ],
    });
    const row = await findReportByPeriod(base, "rec_site_acme", "Maintenance", "2026-05");
    expect(row).toBeNull();
  });

  it("returns null when nothing is seeded", async () => {
    const base = makeFakeBase({ Reports: [] });
    const row = await findReportByPeriod(base, "rec_site_acme", "Maintenance", "2026-05");
    expect(row).toBeNull();
  });

  it("escapes the period and report type to be formula-safe", async () => {
    const base = makeFakeBase({ Reports: [] });
    await findReportByPeriod(base, "rec_x", "Maintenance", '2026-05" OR TRUE()="');
    const formula = (
      base.__calls.find((c) => c.kind === "select")!.opts as {
        filterByFormula: string;
      }
    ).filterByFormula;
    // The injected quote must be escaped, not break out of the literal.
    expect(formula).toContain('2026-05\\" OR TRUE()=\\"');
  });
});
