import { describe, it, expect } from "vitest";
import {
  resolveReportBaseUrl,
  reportUrl,
  reportPrintUrl,
  DEFAULT_REPORT_BASE_URL,
} from "../../src/prospect/report-url.js";

const TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";

describe("resolveReportBaseUrl", () => {
  it("defaults to the marketing site", () => {
    expect(resolveReportBaseUrl(undefined)).toBe("https://reddoorla.com");
    expect(DEFAULT_REPORT_BASE_URL).toBe("https://reddoorla.com");
  });

  it("treats blank and whitespace as unset", () => {
    expect(resolveReportBaseUrl("")).toBe("https://reddoorla.com");
    expect(resolveReportBaseUrl("   ")).toBe("https://reddoorla.com");
  });

  it("strips a trailing slash so callers can append cleanly", () => {
    expect(resolveReportBaseUrl("https://deploy-preview-1.netlify.app/")).toBe(
      "https://deploy-preview-1.netlify.app",
    );
  });
});

describe("reportUrl", () => {
  it("builds the prospect-facing link", () => {
    expect(reportUrl(TOKEN, undefined)).toBe(`https://reddoorla.com/audit/${TOKEN}`);
  });

  it("honours an override, for previews", () => {
    expect(reportUrl(TOKEN, "https://deploy-preview-140--reddoorla.netlify.app")).toBe(
      `https://deploy-preview-140--reddoorla.netlify.app/audit/${TOKEN}`,
    );
  });

  // The point of a separate variable: the dashboard addresses operators on the
  // ops app, this addresses a prospect on the marketing site. Sharing one would
  // mean either audience silently moving the day the other is repointed.
  it("does not point at the ops app", () => {
    expect(reportUrl(TOKEN, undefined)).not.toContain("reddoor-maintenance");
  });
});

describe("reportPrintUrl", () => {
  it("is the report URL plus /print", () => {
    expect(reportPrintUrl(TOKEN, undefined)).toBe(`https://reddoorla.com/audit/${TOKEN}/print`);
  });

  it("stays on the same token as the page it prints", () => {
    expect(reportPrintUrl(TOKEN, undefined)).toContain(TOKEN);
    expect(reportPrintUrl(TOKEN, undefined).startsWith(reportUrl(TOKEN, undefined))).toBe(true);
  });
});
