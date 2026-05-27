import { describe, it, expect } from "vitest";

import { REPORTS_TABLE, escapeFormulaString } from "../../../src/reports/airtable/reports.js";
import { WEBSITES_TABLE, siteSlug } from "../../../src/reports/airtable/websites.js";

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
