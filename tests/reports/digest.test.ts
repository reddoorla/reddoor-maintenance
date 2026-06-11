// tests/reports/digest.test.ts
import { describe, it, expect } from "vitest";
import { renderDigestHtml, type DigestSections } from "../../src/reports/digest.js";

function sections(over: Partial<DigestSections> = {}): DigestSections {
  return {
    readyForYourYes: [
      {
        siteName: "Acme Co",
        reportType: "Maintenance",
        period: "2026-05",
        dashboardUrl: "https://reddoor-maintenance.netlify.app/s/acme-co",
      },
    ],
    needsAttention: [],
    ...over,
  };
}

describe("renderDigestHtml", () => {
  it("renders a 'Ready for your yes' row per report: site, type, period, link", () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain("Ready for your yes");
    expect(html).toContain("Acme Co");
    expect(html).toContain("Maintenance");
    expect(html).toContain("2026-05");
    expect(html).toContain('href="https://reddoor-maintenance.netlify.app/s/acme-co"');
  });

  it("escapes site-controlled strings (no raw HTML injection)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [
          {
            siteName: "Brown & <b>Co</b>",
            reportType: "Maintenance",
            period: "2026-05",
            dashboardUrl: "https://reddoor-maintenance.netlify.app/s/brown-co",
          },
        ],
      }),
    );
    expect(html).toContain("Brown &amp; &lt;b&gt;Co&lt;/b&gt;");
    expect(html).not.toContain("<b>Co</b>");
  });

  it("renders an 'all clear' line for the empty Needs-attention section (the M5 seam)", () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain("Needs attention");
    expect(html).toMatch(/all clear/i);
  });

  it("renders Needs-attention items when the caller fills them (M5-extensible)", () => {
    const html = renderDigestHtml(
      sections({
        needsAttention: [
          { kind: "tracking-issue", title: "daily-reports-failing", url: "https://github.com/x/1" },
        ],
      }),
    );
    expect(html).toContain("daily-reports-failing");
    expect(html).toContain('href="https://github.com/x/1"');
  });

  it("shows a friendly empty state when nothing is ready", () => {
    const html = renderDigestHtml(sections({ readyForYourYes: [] }));
    expect(html).toContain("Ready for your yes");
    expect(html).toMatch(/nothing waiting/i);
  });

  it("does not emit an href when AttentionItem.url is not https:// (XSS guard)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [{ kind: "tracking-issue", title: "bad-link", url: "javascript:alert(1)" }],
      }),
    );
    expect(html).toContain("bad-link");
    expect(html).not.toContain("href");
    expect(html).not.toContain("javascript:");
  });

  // ── email-safety invariant pins ─────────────────────────────────────────────

  it('email-safety: html contains <meta charset="utf-8">', () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('email-safety: outer layout table uses width="600"', () => {
    const html = renderDigestHtml(sections());
    expect(html).toContain('width="600"');
  });

  it("email-safety: anchor style contains font-family:helvetica", () => {
    // The ANCHOR_STYLE constant is inlined into every <a> tag; check a real link.
    const html = renderDigestHtml(sections());
    expect(html).toContain("font-family:helvetica");
  });

  // ── dashboardUrl https guard ────────────────────────────────────────────────

  it("does not emit an href when ReadyItem.dashboardUrl is not https:// (XSS guard)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [
          {
            siteName: "Acme Co",
            reportType: "Maintenance",
            period: "2026-05",
            dashboardUrl: "javascript:alert(1)",
          },
        ],
      }),
    );
    expect(html).toContain("Acme Co");
    expect(html).not.toContain("href");
    expect(html).not.toContain("javascript:");
  });
});
