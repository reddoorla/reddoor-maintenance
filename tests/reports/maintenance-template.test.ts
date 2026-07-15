import { describe, it, expect } from "vitest";
import { fmtDate, buildMjml } from "../../src/reports/maintenance-email/template.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";
import type { ReportData } from "../../src/reports/types.js";

function baseData(over: Partial<ReportData> = {}): ReportData {
  return {
    siteName: "Acme Co",
    siteUrl: "https://acme.example.com",
    reportType: "Maintenance",
    completedOn: new Date("2026-06-01T12:00:00Z"),
    lighthouse: { performance: 87, accessibility: 91, bestPractices: 100, seo: 95 },
    gaUsersCurrent: 2341,
    gaUsersPrevious: 2112,
    lastTestedDate: new Date("2024-12-10T00:00:00Z"),
    commentary: null,
    headerImageCid: "acme-header",
    ...over,
  };
}

describe("fmtDate", () => {
  it("formats a valid UTC date as MM.DD.YYYY", () => {
    expect(fmtDate(new Date("2026-06-01T00:00:00Z"))).toBe("06.01.2026");
  });

  it("returns empty string for null", () => {
    expect(fmtDate(null)).toBe("");
  });

  it("returns empty string for an Invalid Date — NOT 'NaN.NaN.NaN' in a client email", () => {
    // `new Date("not-a-date")` is a truthy Date whose getUTC* accessors are NaN.
    expect(fmtDate(new Date("not-a-date"))).toBe("");
    expect(fmtDate(new Date("2026-13-45"))).toBe("");
  });
});

describe("buildMjml commentary line breaks", () => {
  it("renders CRLF (\\r\\n) as <br/> with no stray carriage return left in the markup", () => {
    const mjml = buildMjml(baseData({ commentary: "First line.\r\nSecond line." }));
    expect(mjml).toContain("First line.<br/>Second line.");
    expect(mjml).not.toContain("\r");
  });

  it("still renders plain LF (\\n) breaks", () => {
    const mjml = buildMjml(baseData({ commentary: "A\nB" }));
    expect(mjml).toContain("A<br/>B");
  });
});

describe("buildMjml contact heading", () => {
  it("renders the first contact line ('Just hit reply.') as a red bold heading", () => {
    const mjml = buildMjml(baseData());
    expect(mjml).toContain(
      `<mj-text color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" line-height="30px">Just hit reply.</mj-text>`,
    );
  });

  it("applies BOTH red heading and the closing padding when a single-line contact override is its own last line", () => {
    const mjml = buildMjml(baseData({ copy: { ...DEFAULT_COPY, contact: ["Just hit reply."] } }));
    expect(mjml).toContain(
      `<mj-text color="#C00" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="0px" line-height="30px" padding-bottom="36px">Just hit reply.</mj-text>`,
    );
  });

  it("renders the second contact line grey, matching the launch/announcement templates", () => {
    // Without an explicit color the line fell to MJML's near-black default —
    // the sibling templates render every non-first contact line #757575.
    const mjml = buildMjml(baseData());
    expect(mjml).toContain(
      `<mj-text color="#757575" font-family="helvetica, sans-serif" font-size="24px" font-weight="300" padding-top="0px" line-height="30px" padding-bottom="36px">We&#39;re here to help in any way we can.</mj-text>`,
    );
  });
});
