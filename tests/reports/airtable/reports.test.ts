import { describe, it, expect } from "vitest";

import {
  REPORTS_TABLE,
  escapeFormulaString,
  createDraft,
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
});
