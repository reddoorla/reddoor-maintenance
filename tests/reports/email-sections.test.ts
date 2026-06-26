import { describe, it, expect } from "vitest";
import {
  checklistRowsSection,
  lighthouseScoresSection,
  analyticsSection,
  analyticsTrendLine,
  hasAnalyticsData,
  fmtUsers,
} from "../../src/reports/email-sections.js";

describe("fmtUsers", () => {
  it("groups thousands (en-US)", () => {
    expect(fmtUsers(12345)).toBe("12,345");
    expect(fmtUsers(7)).toBe("7");
  });
});

describe("checklistRowsSection", () => {
  it("renders one row per label, each with the green check image, on the given background", () => {
    const mjml = checklistRowsSection(["Alpha", "Beta", "Gamma"], {
      background: "#F4F4F4",
      lastPaddingBottom: "60px",
    });
    expect(mjml).toContain("Alpha");
    expect(mjml).toContain("Beta");
    expect(mjml).toContain("Gamma");
    expect((mjml.match(/cid:rd-check-png/g) ?? []).length).toBe(3);
    expect((mjml.match(/background-color="#F4F4F4"/g) ?? []).length).toBe(3);
  });
  it("rules every row but the last, and applies lastPaddingBottom only to the last", () => {
    const mjml = checklistRowsSection(["One", "Two"], {
      background: "white",
      lastPaddingBottom: "36px",
    });
    // First row ruled (border-bottom), last row not; last row carries the trailing pad.
    expect((mjml.match(/border-bottom="solid #CCCCCC 1px"/g) ?? []).length).toBe(2); // 2 columns of row 1
    expect(mjml).toContain('padding-bottom="36px"');
  });
  it("escapes labels", () => {
    const mjml = checklistRowsSection(["A & B <c>"], {
      background: "white",
      lastPaddingBottom: "0",
    });
    expect(mjml).not.toContain("A & B <c>");
    expect(mjml).toContain("A &amp; B &lt;c&gt;");
  });
});

describe("lighthouseScoresSection", () => {
  const lh = { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 };
  it("renders the four labelled scores with their bands and the footnote", () => {
    const mjml = lighthouseScoresSection(lh);
    expect(mjml).toContain("LIGHTHOUSE SCORES*");
    expect(mjml).toContain(">Performance</mj-text>");
    expect(mjml).toContain(">Readability (A11y)</mj-text>");
    expect(mjml).toContain(">Best Practices</mj-text>");
    expect(mjml).toContain(">Site Structure</mj-text>");
    expect(mjml).toContain(">90</mj-text>");
    expect(mjml).toContain(">82</mj-text>");
    expect(mjml).toContain("*A Lighthouse score is a numerical measure");
  });
  it("makes every Ideal band top out at 100", () => {
    const mjml = lighthouseScoresSection(lh);
    expect(mjml).toContain("Ideal 90–100"); // Performance / Site Structure
    expect(mjml).toContain("Ideal 100"); // Readability
    expect(mjml).toContain("Ideal 80–100"); // Best Practices (was 80–92)
    expect(mjml).not.toContain("Ideal 80–92");
  });
  it("rules between scores only (3 dividers for 4 scores)", () => {
    const mjml = lighthouseScoresSection(lh);
    expect((mjml.match(/mj-divider/g) ?? []).length).toBe(3);
  });
  it("links the footnote's 'Google's Lighthouse tool' to the Lighthouse docs", () => {
    const mjml = lighthouseScoresSection(lh);
    expect(mjml).toContain('href="https://developer.chrome.com/docs/lighthouse/overview"');
    expect(mjml).toContain(">Google's Lighthouse tool</a>");
  });
});

describe("hasAnalyticsData", () => {
  it("is true with a user count (incl. a real 0) or a body line; false otherwise", () => {
    expect(hasAnalyticsData({ current: 0 })).toBe(true);
    expect(hasAnalyticsData({ bodyLines: ["x"] })).toBe(true);
    expect(hasAnalyticsData({})).toBe(false);
    expect(hasAnalyticsData({ bodyLines: [] })).toBe(false);
  });
});

describe("analyticsTrendLine", () => {
  it("shows an up trend in green with the range", () => {
    expect(analyticsTrendLine(679, 549)).toContain("▲ 24% vs last period (549 → 679)");
  });
  it("shows a down trend muted", () => {
    expect(analyticsTrendLine(400, 500)).toContain("▼ 20% vs last period (500 → 400)");
  });
  it("falls back to Last Period when the current is unavailable", () => {
    expect(analyticsTrendLine(undefined, 500)).toContain("Last Period: 500");
  });
  it("shows 'No change' when the period is flat", () => {
    expect(analyticsTrendLine(500, 500)).toContain("No change vs last period (500)");
  });
  it("shows 'Last Period: 0' when both periods are zero", () => {
    expect(analyticsTrendLine(0, 0)).toContain("Last Period: 0");
  });
  it("labels the prior window concretely when periodDays is given", () => {
    expect(analyticsTrendLine(679, 549, 30)).toContain("▲ 24% vs the previous 30 days (549 → 679)");
    expect(analyticsTrendLine(400, 500, 30)).toContain("▼ 20% vs the previous 30 days (500 → 400)");
    expect(analyticsTrendLine(500, 500, 30)).toContain("No change vs the previous 30 days (500)");
  });
  it("falls back to 'last period' when periodDays is absent or non-positive", () => {
    expect(analyticsTrendLine(679, 549)).toContain("vs last period");
    expect(analyticsTrendLine(679, 549, 0)).toContain("vs last period");
  });
});

describe("analyticsSection", () => {
  it("renders the user count, trend, body lines, and footnotes", () => {
    const mjml = analyticsSection({
      current: 12345,
      previous: 6789,
      background: "white",
      bodyLines: ["Page 1 Google result (#3)"],
      footnoteLines: ["See more data"],
    });
    expect(mjml).toContain(">ANALYTICS</mj-text>");
    expect(mjml).toContain("12,345 Users");
    expect(mjml).toContain("vs last period");
    expect(mjml).toContain("Page 1 Google result (#3)");
    expect(mjml).toContain("See more data");
  });
  it("hides the block entirely when there's no data (no user count, no body lines)", () => {
    expect(analyticsSection({ background: "white" })).toBe("");
    // A lone SEO call-to-action footnote isn't data — still hidden.
    expect(analyticsSection({ background: "white", footnoteLines: ["See more data"] })).toBe("");
  });
  it("renders without a user count when only a body line is present (GA-less, still ranks)", () => {
    const mjml = analyticsSection({
      background: "white",
      bodyLines: ["Page 1 Google result (#3)"],
    });
    expect(mjml).toContain(">ANALYTICS</mj-text>");
    expect(mjml).toContain("Page 1 Google result (#3)");
    expect(mjml).not.toContain("Users"); // no "— Users" / "0 Users"
  });
  it("threads periodDays into the trend label", () => {
    const mjml = analyticsSection({
      current: 280,
      previous: 275,
      periodDays: 30,
      background: "white",
    });
    expect(mjml).toContain("vs the previous 30 days");
  });
});
