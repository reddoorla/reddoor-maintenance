import { describe, it, expect } from "vitest";
import { renderReportHtml } from "../../src/reports/render.js";
import type { ReportData } from "../../src/reports/types.js";
import { DEFAULT_COPY } from "../../src/reports/copy.js";

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

describe("renderReportHtml", () => {
  it("renders without MJML warnings on default data", async () => {
    const { warnings } = await renderReportHtml(baseData());
    expect(warnings).toEqual([]);
  });

  it("interpolates all four Lighthouse scores (no hardcoded 90s)", async () => {
    const { html } = await renderReportHtml(
      baseData({ lighthouse: { performance: 12, accessibility: 34, bestPractices: 56, seo: 78 } }),
    );
    expect(html).toContain(">12<");
    expect(html).toContain(">34<");
    expect(html).toContain(">56<");
    expect(html).toContain(">78<");
    expect(html).not.toContain(">90<");
  });

  // H10 regression: swapping data.lighthouse.performance and .accessibility in
  // the template would still pass the score-presence test above. This pins the
  // POSITIONAL contract by checking that each score sits under its labeled
  // section. Each chunk of the template runs from one section label to the next.
  it("places each score under the correct section label (positional)", async () => {
    const { html } = await renderReportHtml(
      baseData({ lighthouse: { performance: 12, accessibility: 34, bestPractices: 56, seo: 78 } }),
    );
    const perfIdx = html.indexOf(">Performance<");
    const readIdx = html.indexOf(">Readability (A11y)<");
    const bpIdx = html.indexOf(">Best Practices<");
    const seoIdx = html.indexOf(">Site Structure<");

    expect(perfIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(perfIdx);
    expect(bpIdx).toBeGreaterThan(readIdx);
    expect(seoIdx).toBeGreaterThan(bpIdx);

    // The first occurrence of ">12<" must be between the Performance label
    // and the next label (Readability (A11y)). Likewise for the others.
    const firstPerfScore = html.indexOf(">12<");
    const firstReadScore = html.indexOf(">34<");
    const firstBpScore = html.indexOf(">56<");
    const firstSeoScore = html.indexOf(">78<");

    expect(firstPerfScore).toBeGreaterThan(perfIdx);
    expect(firstPerfScore).toBeLessThan(readIdx);

    expect(firstReadScore).toBeGreaterThan(readIdx);
    expect(firstReadScore).toBeLessThan(bpIdx);

    expect(firstBpScore).toBeGreaterThan(bpIdx);
    expect(firstBpScore).toBeLessThan(seoIdx);

    expect(firstSeoScore).toBeGreaterThan(seoIdx);
  });

  it("labels the third score 'Best Practices' (not duplicate 'Performance')", async () => {
    const { html } = await renderReportHtml(baseData());
    expect(html).toContain("Best Practices");
    expect(html.match(/>Performance</g)?.length ?? 0).toBe(1);
  });

  it("uses cid:headerImageCid for the header image src", async () => {
    const { html } = await renderReportHtml(baseData({ headerImageCid: "client-xyz-header" }));
    expect(html).toContain('src="cid:client-xyz-header"');
  });

  it("reserves the header box via aspect-ratio (proportional, never distorts) + placeholder", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({ headerWidth: 600, headerHeight: 800, headerBgColor: "#cfc3a8" }),
    );
    expect(warnings).toEqual([]);
    // Space is reserved by aspect-ratio (not a fixed pixel height).
    expect(html).toMatch(/aspect-ratio:\s*600\s*\/\s*800/);
    // Placeholder color shows while the image loads or if the client blocks images.
    expect(html).toContain("#cfc3a8");
    // Alt text for blocked-image clients.
    expect(html).toContain('alt="Acme Co maintenance report"');

    // REGRESSION (squished header, 2026-06-01): the header <img> must scale
    // proportionally. A fixed pixel height combined with MJML's width:100% locks
    // the height while the width scales, distorting the image at any width != 600px
    // (mobile, narrow reading panes). The inline style MUST be height:auto and MUST
    // NOT contain a fixed pixel height.
    const i = html.indexOf("cid:acme-header");
    const imgTag = html.slice(html.lastIndexOf("<img", i), html.indexOf("/>", i) + 2);
    expect(imgTag).toMatch(/height:\s*auto/);
    expect(imgTag).not.toMatch(/height:\s*\d+px/);
  });

  it("falls back to a bare header (no placeholder color) when dimensions are absent", async () => {
    const { html } = await renderReportHtml(baseData());
    expect(html).toContain('alt="Acme Co maintenance report"');
    expect(html).not.toContain("container-background-color");
  });

  it("escapes special chars in siteName / siteUrl / commentary (no MJML break)", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({
        siteName: "Brown & Co <Web>",
        siteUrl: 'https://x.com/?a=1&b="2"',
        commentary: 'Patched <header> & "footer"',
        headerWidth: 600,
        headerHeight: 800,
        headerBgColor: "#cccccc",
      }),
    );
    // Strict MJML render must not choke on the special characters.
    expect(warnings).toEqual([]);
    // siteName ampersand is escaped wherever it interpolates (alt, preview text).
    expect(html).toContain("Brown &amp; Co");
    expect(html).not.toContain("Brown & Co <Web>");
    // siteUrl ampersand/quote escaped in the header href attribute.
    expect(html).toContain("a=1&amp;b=");
    // commentary is escaped before the newline→<br/> substitution.
    expect(html).toContain("Patched &lt;header&gt; &amp;");
  });

  it("drops a non-http(s) siteUrl from the header href (no javascript: scheme)", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({
        siteUrl: "javascript:alert(1)",
        headerWidth: 600,
        headerHeight: 800,
        headerBgColor: "#cccccc",
      }),
    );
    expect(warnings).toEqual([]);
    // The dangerous scheme must NOT survive into an href.
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain('href="javascript:');
    // It falls back to a neutral "#" href instead of linking the payload.
    expect(html).toContain('href="#"');
  });

  it("drops a data: siteUrl from the launch header href too (shared headerImageTag)", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({ reportType: "Launch", siteUrl: "data:text/html,<script>1</script>" }),
    );
    expect(warnings).toEqual([]);
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain('href="data:');
  });

  it("keeps a valid https siteUrl as the header href", async () => {
    const { html } = await renderReportHtml(baseData({ siteUrl: "https://acme.example.com" }));
    expect(html).toContain('href="https://acme.example.com"');
  });

  describe("analytics trend", () => {
    it("shows ▲ percent + range when users grew", async () => {
      const { html } = await renderReportHtml(
        baseData({ gaUsersCurrent: 679, gaUsersPrevious: 549 }),
      );
      expect(html).toContain("▲ 24% vs last period (549 → 679)");
      expect(html).toContain("#2E7D32"); // positive green
    });

    it("shows ▼ percent in muted grey when users dropped", async () => {
      const { html } = await renderReportHtml(
        baseData({ gaUsersCurrent: 400, gaUsersPrevious: 500 }),
      );
      expect(html).toContain("▼ 20% vs last period (500 → 400)");
    });

    it("shows 'New this period' when the previous period was a real 0", async () => {
      const { html } = await renderReportHtml(
        baseData({ gaUsersCurrent: 120, gaUsersPrevious: 0 }),
      );
      expect(html).toContain("New this period");
    });

    it("hides the analytics block entirely when GA is unavailable", async () => {
      const { html } = await renderReportHtml(
        baseData({ gaUsersCurrent: undefined, gaUsersPrevious: undefined }),
      );
      // No empty "— Users" block; the section (and its SEO footnote) is omitted.
      expect(html).not.toContain(">ANALYTICS</mj-text>");
      expect(html).not.toContain("Users");
      expect(html).not.toContain("Last Period");
    });
  });

  it("renders the testing checklist when reportType is Testing", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Testing" }));
    expect(html).toContain("Desktop Browsers");
    expect(html).toContain("Form Functionality");
    // Maintenance-only blurred-tests CID should NOT appear.
    expect(html).not.toContain("rd-blurred-tests-jpg");
  });

  it("renders the blurred-tests placeholder when reportType is Maintenance", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Maintenance" }));
    expect(html).toContain("rd-blurred-tests-jpg");
    expect(html).not.toContain("Desktop Browsers");
  });

  it("references the check.png CID in checklist rows (no external CDN URL)", async () => {
    const { html } = await renderReportHtml(baseData({ reportType: "Maintenance" }));
    expect(html).toContain("cid:rd-check-png");
    expect(html).not.toContain("d3eq0h5l8sxf6t.cloudfront.net");
  });

  it("shows Last Tested date on Maintenance reports (US format MM.DD.YYYY)", async () => {
    const { html } = await renderReportHtml(
      baseData({ reportType: "Maintenance", lastTestedDate: new Date("2025-03-15T00:00:00Z") }),
    );
    expect(html).toContain("03.15.2025");
  });

  it("omits the NOTES section when commentary is null", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: null }));
    expect(html).not.toContain(">NOTES<");
  });

  it("renders the NOTES section when commentary is non-empty", async () => {
    const { html } = await renderReportHtml(
      baseData({ commentary: "Migrated DNS to Cloudflare." }),
    );
    expect(html).toContain(">NOTES<");
    expect(html).toContain("Migrated DNS to Cloudflare.");
  });

  it("preserves newlines in commentary as <br/>", async () => {
    const { html } = await renderReportHtml(baseData({ commentary: "Line one.\nLine two." }));
    expect(html).toContain("Line one.<br/>Line two.");
  });

  it("formats GA user counts with thousands separators", async () => {
    const { html } = await renderReportHtml(
      baseData({ gaUsersCurrent: 12345, gaUsersPrevious: 6789 }),
    );
    expect(html).toContain("12,345 Users");
    // Both counts carry thousands separators — now shown in the trend range line.
    expect(html).toContain("(6,789 → 12,345)");
  });

  it("uses the site name in the preview text", async () => {
    const { html } = await renderReportHtml(baseData({ siteName: "Med Solutions of Texas" }));
    expect(html).toContain("Checked up on Med Solutions of Texas");
  });

  it("enriches the Google Indexed row with the rank when on page 1", async () => {
    const { html } = await renderReportHtml(baseData({ searchPosition: 2 }));
    expect(html).toContain("Page 1 Google Result (#2)");
    expect(html).not.toContain("Google Indexed");
  });

  it("renders the plain Google Indexed row when no search position", async () => {
    const { html } = await renderReportHtml(baseData({ searchPosition: undefined }));
    expect(html).toContain("Google Indexed");
    expect(html).not.toContain("Page 1 Google Result");
  });

  // Byte-identical: a report with no `copy` renders exactly as before (the existing
  // assertions already pin this — keep them green). Add an override check:
  it("a per-site copy override changes only that string", async () => {
    const base = baseData();
    const { html } = await renderReportHtml({
      ...base,
      copy: { ...DEFAULT_COPY, maintenanceIntro: "ZZZ-CUSTOM-INTRO" },
    });
    expect(html).toContain("ZZZ-CUSTOM-INTRO");
    expect(html).not.toContain(DEFAULT_COPY.maintenanceIntro);
  });

  // The closing contact block is operator-overridable copy, so ALL of it (default
  // and override alike) is now HTML-escaped — the default apostrophe renders as its
  // entity. Pins the intended escaping (pre-M6a the default rendered a raw '; the
  // glyph is visually identical). Without this the byte change would be unpinned.
  it("renders the default contact block, HTML-escaped (no raw apostrophe)", async () => {
    const { html } = await renderReportHtml(baseData());
    expect(html).toContain("here to help in any way we can.");
    expect(html).toContain("Just hit reply.");
    expect(html).not.toContain("We're here to help"); // the raw ' is escaped to an entity
  });

  it("escapes a per-site contact override (operator text is safe in strict MJML)", async () => {
    const { html } = await renderReportHtml({
      ...baseData(),
      copy: { ...DEFAULT_COPY, contact: ["Reach us at <a> & co"] },
    });
    expect(html).toContain("Reach us at &lt;a&gt; &amp; co");
    expect(html).not.toContain("Reach us at <a> & co");
  });

  it("renders a purpose-built launch email (no maintenance sections)", async () => {
    const { html, warnings } = await renderReportHtml(baseData({ reportType: "Launch" }));
    expect(warnings).toEqual([]);
    expect(html).toContain("LAUNCHED");
    // launchBody contains apostrophes ("We've", "Here's") that escape to entities,
    // so assert a special-char-free substring of it instead of the raw string.
    expect(html).toContain("Your site is live");
    expect(html).toContain(DEFAULT_COPY.launchSetupItems[0]!);
    // purpose-built: no maintenance/checks/analytics sections
    expect(html).not.toContain("MAINTENANCE CHECKS");
    expect(html).not.toContain("LIGHTHOUSE SCORES");
    expect(html).not.toContain("ANALYTICS");
    // still carries the shared copy layer (contact + footer)
    expect(html).toContain("Just hit reply.");
    expect(html).toContain(DEFAULT_COPY.footerOrg);
  });

  it("honors a per-site contact/footer override on the launch email", async () => {
    const { html } = await renderReportHtml({
      ...baseData({ reportType: "Launch" }),
      copy: { ...DEFAULT_COPY, footerOrg: "Beta LLC" },
    });
    expect(html).toContain("Beta LLC");
  });

  it("dispatches to the announcement email when reportType is Announcement", async () => {
    const { html, warnings } = await renderReportHtml(
      baseData({ reportType: "Announcement", copy: DEFAULT_COPY }),
    );
    expect(warnings).toEqual([]);
    // The announcement reuses the report's components (LIGHTHOUSE SCORES etc.), so it's
    // distinguished by its own heading and by the ABSENCE of the report's "COMPLETED ON" header.
    expect(html).toContain("YOUR ONGOING SITE CARE"); // announceHeading — announcement-only
    expect(html).not.toContain("COMPLETED ON"); // report-only — confirms the announcement template
  });
});
