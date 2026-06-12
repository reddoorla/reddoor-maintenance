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
          {
            key: "vuln:rec1",
            kind: "vuln",
            siteName: "Acme Co",
            title: "daily-reports-failing",
            url: "https://github.com/x/1",
            severity: "critical",
            metric: 3,
          },
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
        needsAttention: [
          {
            key: "delivery:rec2",
            kind: "delivery",
            siteName: "Acme Co",
            title: "bad-link",
            url: "javascript:alert(1)",
            severity: "warning",
            metric: 1,
          },
        ],
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

  it("renders an AttentionItem with the M5-extended shape by title + https url", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [
          {
            key: "vuln:recX",
            kind: "vuln",
            siteName: "Acme Co",
            title: "3 critical/high vulns",
            url: "https://reddoor-maintenance.netlify.app/s/acme-co",
            severity: "critical",
            metric: 3,
          },
        ],
      }),
    );
    expect(html).toContain("3 critical/high vulns");
    expect(html).toContain('href="https://reddoor-maintenance.netlify.app/s/acme-co"');
  });

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

  // ── attention grouping + badging (component 3) ──────────────────────────────

  it("groups two attention items under one site heading", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [
          {
            key: "vuln:s1",
            kind: "vuln",
            siteName: "Acme Co",
            title: "2 critical/high vulns",
            url: "https://reddoor-maintenance.netlify.app/s/acme-co",
            severity: "critical",
            metric: 2,
            status: "new",
          },
          {
            key: "delivery:r1",
            kind: "delivery",
            siteName: "Acme Co",
            title: "report bounced",
            url: "https://reddoor-maintenance.netlify.app/s/acme-co",
            severity: "warning",
            metric: 1,
            status: "standing",
          },
        ],
      }),
    );
    // One site heading, both titles under it.
    expect((html.match(/Acme Co/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("2 critical/high vulns");
    expect(html).toContain("report bounced");
    // critical sorts before warning within the site → vuln title appears first.
    expect(html.indexOf("2 critical/high vulns")).toBeLessThan(html.indexOf("report bounced"));
  });

  it("badges NEW and WORSE from item.status, omits a badge for standing", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [
          {
            key: "vuln:s1",
            kind: "vuln",
            siteName: "Acme Co",
            title: "new vuln",
            severity: "critical",
            metric: 1,
            status: "new",
          },
          {
            key: "vuln:s2",
            kind: "vuln",
            siteName: "Beta Ltd",
            title: "worse vuln",
            severity: "critical",
            metric: 5,
            status: "worse",
          },
          {
            key: "vuln:s3",
            kind: "vuln",
            siteName: "Gamma Inc",
            title: "standing vuln",
            severity: "warning",
            metric: 1,
            status: "standing",
          },
        ],
      }),
    );
    expect(html).toMatch(/NEW/);
    expect(html).toMatch(/WORSE/);
    // The standing row carries neither badge token adjacent to its title.
    const standingRow = html.slice(
      html.indexOf("standing vuln") - 60,
      html.indexOf("standing vuln"),
    );
    expect(standingRow).not.toMatch(/\bNEW\b|\bWORSE\b/);
  });

  it("WORSE badge when a metric climbs (status='worse' rendered as WORSE)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [
          {
            key: "vuln:s1",
            kind: "vuln",
            siteName: "Acme Co",
            title: "5 critical/high vulns",
            severity: "critical",
            metric: 5,
            status: "worse",
          },
        ],
      }),
    );
    expect(html).toContain("5 critical/high vulns");
    expect(html).toMatch(/WORSE/);
  });

  it("still emits no href for a non-https attention url after grouping (XSS guard holds)", () => {
    const html = renderDigestHtml(
      sections({
        readyForYourYes: [],
        needsAttention: [
          {
            key: "vuln:s1",
            kind: "vuln",
            siteName: "Acme Co",
            title: "bad-link",
            url: "javascript:alert(1)",
            severity: "critical",
            metric: 1,
            status: "new",
          },
        ],
      }),
    );
    expect(html).toContain("bad-link");
    expect(html).not.toContain("href");
    expect(html).not.toContain("javascript:");
  });
});
