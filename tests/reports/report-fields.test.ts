import { describe, it, expect } from "vitest";

import {
  REPORTS_TABLE,
  draftFields,
  mapRow,
  toReportType,
} from "../../src/reports/report-fields.js";
import { WEBSITES_TABLE, siteSlug } from "../../src/fleet/site-fields.js";
import { reportRowsFrom } from "../_helpers/raw-rows.js";

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

describe("draftFields Period field", () => {
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

  it("writes the Period field when supplied", () => {
    expect(draftFields({ ...baseInput, period: "2026-05" })["Period"]).toBe("2026-05");
  });

  it("omits the Period field when not supplied (back-compat)", () => {
    expect(draftFields(baseInput)["Period"]).toBeUndefined();
  });

  it("maps the Period field back onto the row", () => {
    const row = mapRow({ id: "rec_new", fields: draftFields({ ...baseInput, period: "2026-05" }) });
    expect(row.period).toBe("2026-05");
  });

  it("writes the Subject override field when supplied", () => {
    expect(draftFields({ ...baseInput, subjectOverride: "Hello" })["Subject override"]).toBe(
      "Hello",
    );
  });

  it("omits the Subject override field when not supplied", () => {
    expect(draftFields(baseInput)).not.toHaveProperty("Subject override");
  });
});

describe("toReportType", () => {
  it("round-trips Announcement", () => {
    expect(toReportType("Announcement")).toBe("Announcement");
  });
});

describe("mapRow Report type", () => {
  it("maps a known Report type through, and an UNKNOWN single-select option to Maintenance", () => {
    const rows = reportRowsFrom([
      { id: "rec_launch", fields: { "Report ID": "L", "Report type": "Launch" } },
      { id: "rec_bogus", fields: { "Report ID": "Q", "Report type": "Quarterly" } },
      { id: "rec_blank", fields: { "Report ID": "Z" } },
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.reportType]));
    expect(byId["rec_launch"]).toBe("Launch");
    // An unexpected option must NOT slip through and silently mis-template the email.
    expect(byId["rec_bogus"]).toBe("Maintenance");
    expect(byId["rec_blank"]).toBe("Maintenance");
  });
});

describe("mapRow checklist", () => {
  it("reads the 13 checkbox cells into row.checklist; true cells true, absent cells false", () => {
    const row = mapRow({
      id: "rec_checklist",
      fields: {
        "Report ID": "C",
        "Report type": "Maintenance",
        "Maint: Deploy & Function Health": true,
        "Maint: Domain, DNS & SSL": true,
        // The other 11 cells are absent → must read false.
      },
    });
    expect(row.checklist["Maint: Deploy & Function Health"]).toBe(true);
    expect(row.checklist["Maint: Domain, DNS & SSL"]).toBe(true);
    // Absent cells default to false (legacy rows created before the fields existed).
    expect(row.checklist["Maint: CMS Checked"]).toBe(false);
    expect(row.checklist["Maint: Google Indexed"]).toBe(false);
    expect(row.checklist["Test: Desktop Browsers"]).toBe(false);
    // All 13 keys are present.
    expect(Object.keys(row.checklist)).toHaveLength(13);
  });
});
