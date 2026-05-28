import { describe, it, expect } from "vitest";
import { renderFleetHomeHtml } from "../../src/dashboard/fleet-render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    ga4PropertyId: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    dashboardToken: "tok",
    ...over,
  };
}

describe("renderFleetHomeHtml", () => {
  it("returns a full HTML document", () => {
    const html = renderFleetHomeHtml([siteRow()]);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain('<meta name="viewport"');
  });

  it("includes a sensible page title", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/<title>[^<]*Reddoor[^<]*<\/title>/);
  });

  it("renders one row per site with the site name visible", () => {
    const html = renderFleetHomeHtml([
      siteRow({ id: "rec1", name: "Acme Co" }),
      siteRow({ id: "rec2", name: "Beta Inc" }),
      siteRow({ id: "rec3", name: "Gamma LLC" }),
    ]);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links each site row to /s/<slug>?t=<token> using the dashboardToken", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "CalTex", dashboardToken: "abc123" })]);
    // slug derives from name via siteSlug() → "caltex"
    expect(html).toContain('href="/s/caltex?t=abc123"');
  });

  it("renders sites without a dashboardToken as inactive (no link, visible badge)", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "Unconfigured Co", dashboardToken: null })]);
    expect(html).toContain(">Unconfigured Co<");
    // No href to a /s/... path for this site
    expect(html).not.toMatch(/href="\/s\/unconfigured-co/);
    // A clear "no token" marker so the operator knows to set it
    expect(html).toMatch(/no token/i);
  });

  it("renders lighthouse score numbers per row when scores are present", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 }),
    ]);
    expect(html).toContain(">73<");
    expect(html).toContain(">100<");
    expect(html).toContain(">78<");
  });

  it("renders a placeholder for sites with null scores (never audited)", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
    ]);
    // Em-dash (or similar) for unset scores, NOT the literal "null"
    expect(html).not.toContain(">null<");
    expect(html).toMatch(/<td class="score">—<\/td>/);
  });

  it("renders a friendly empty state when the fleet has zero sites", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/no sites/i);
  });

  it("escapes HTML in site names and URLs so untrusted Airtable values cannot inject markup", () => {
    const html = renderFleetHomeHtml([
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
    ]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("escapes the dashboard token in the href so a token with special chars cannot break the URL", () => {
    // Defensive: tokens are operator-generated hex in practice, but the
    // type is `string` and an operator could paste anything. Escaping
    // the token in href context prevents that from becoming an injection
    // vector if someone ever pastes "abc&foo=bar" or similar.
    const html = renderFleetHomeHtml([siteRow({ name: "Acme", dashboardToken: 'a"b&c' })]);
    expect(html).not.toMatch(/href="[^"]*"[^"]*b&c/);
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });
});
