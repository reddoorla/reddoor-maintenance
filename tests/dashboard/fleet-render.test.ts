import { describe, it, expect } from "vitest";
import { renderFleetHomeHtml } from "../../src/dashboard/fleet-render.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    ga4PropertyId: null,
    reportRecipientsTo: "tucker@reddoorla.com",
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    dashboardToken: "tok",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  };
}

describe("renderFleetHomeHtml — document shell", () => {
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

  it("renders the empty state when no sites are passed", () => {
    const html = renderFleetHomeHtml([]);
    expect(html).toMatch(/no sites/i);
  });
});

describe("renderFleetHomeHtml — card per site", () => {
  it('emits one <article class="card"> per site', () => {
    const html = renderFleetHomeHtml([
      siteRow({ id: "rec1", name: "Acme Co" }),
      siteRow({ id: "rec2", name: "Beta Inc" }),
      siteRow({ id: "rec3", name: "Gamma LLC" }),
    ]);
    const cards = html.match(/<article class="card"/g) ?? [];
    expect(cards).toHaveLength(3);
    expect(html).toContain(">Acme Co<");
    expect(html).toContain(">Beta Inc<");
    expect(html).toContain(">Gamma LLC<");
  });

  it("links the site name to /s/<slug>?t=<token>", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "CalTex", dashboardToken: "abc123" })]);
    expect(html).toContain('href="/s/caltex?t=abc123"');
  });
});

describe("renderFleetHomeHtml — header row (setup + audited)", () => {
  it("shows '4/4' when the site is fully onboarded", () => {
    const html = renderFleetHomeHtml([siteRow()]);
    expect(html).toContain(">4/4<");
  });

  it("shows the partial fraction when the site is missing some onboarding signals", () => {
    const html = renderFleetHomeHtml([siteRow({ pointOfContact: null, reportRecipientsTo: null })]);
    expect(html).toContain(">2/4<");
  });

  it("renders the lighthouse-audited timestamp as a relative-time string", () => {
    // 2026-05-27T18:00:00Z viewed at 2026-05-28T18:00:00Z = 24h = '1d ago'.
    // We can't pin "now" in the render layer, so just assert SOMETHING
    // relative-time-shaped renders for a non-null timestamp and that "—"
    // renders for a null timestamp.
    const audited = renderFleetHomeHtml([siteRow()]);
    expect(audited).toMatch(/(just now|\d+[mhdw]o? ago)/);

    const never = renderFleetHomeHtml([siteRow({ lastLighthouseAuditAt: null })]);
    expect(never).toMatch(/Audited[^<]*<[^>]*>\s*—\s*</);
  });
});

describe("renderFleetHomeHtml — metrics row", () => {
  it("renders the four lighthouse scores", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: 73, rScore: 100, bpScore: 78, seoScore: 100 }),
    ]);
    // The implementer must label the 4 numbers in DOM (e.g. spans with
    // class="score perf" etc.) so this test can target precisely. Until
    // then, the looser content assertion below is the contract.
    expect(html).toContain(">73<");
    expect(html).toContain(">78<");
  });

  it("renders an em-dash placeholder for null lighthouse scores", () => {
    const html = renderFleetHomeHtml([
      siteRow({ pScore: null, rScore: null, bpScore: null, seoScore: null }),
    ]);
    expect(html).not.toContain(">null<");
    expect(html).toMatch(/<span class="score perf">—<\/span>/);
  });

  it("renders the a11y violation count", () => {
    const html = renderFleetHomeHtml([siteRow({ a11yViolations: 3 })]);
    expect(html).toMatch(/<span class="metric a11y">3<\/span>/);
  });

  it("renders '—' for a never-audited a11y count", () => {
    const html = renderFleetHomeHtml([siteRow({ a11yViolations: null })]);
    expect(html).toMatch(/<span class="metric a11y">—<\/span>/);
  });

  it("renders deps as 'N drifted (M major)' when there is drift", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: 5, depsMajorBehind: 1 })]);
    expect(html).toMatch(/<span class="metric deps">5 drifted \(1 major\)<\/span>/);
  });

  it("renders deps with '(0 major)' when there is non-major drift only", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: 5, depsMajorBehind: 0 })]);
    expect(html).toMatch(/<span class="metric deps">5 drifted \(0 major\)<\/span>/);
  });

  it("renders deps as '0' when clean", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: 0, depsMajorBehind: 0 })]);
    expect(html).toMatch(/<span class="metric deps">0<\/span>/);
  });

  it("renders deps as '—' when never audited", () => {
    const html = renderFleetHomeHtml([siteRow({ depsDrifted: null, depsMajorBehind: null })]);
    expect(html).toMatch(/<span class="metric deps">—<\/span>/);
  });

  it("renders security as 'C/H/M/L' format when there are vulns", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: 1,
        securityVulnsHigh: 2,
        securityVulnsModerate: 3,
        securityVulnsLow: 4,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">1C\/2H\/3M\/4L<\/span>/);
  });

  it("renders security as '0' when clean", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityVulnsModerate: 0,
        securityVulnsLow: 0,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">0<\/span>/);
  });

  it("renders security as '—' when never audited", () => {
    const html = renderFleetHomeHtml([
      siteRow({
        securityVulnsCritical: null,
        securityVulnsHigh: null,
        securityVulnsModerate: null,
        securityVulnsLow: null,
      }),
    ]);
    expect(html).toMatch(/<span class="metric sec">—<\/span>/);
  });
});

describe("renderFleetHomeHtml — escaping & safety", () => {
  it("escapes HTML in site names and URLs", () => {
    const html = renderFleetHomeHtml([
      siteRow({ name: "<script>alert(1)</script>", url: "javascript:alert(1)" }),
    ]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("escapes the dashboard token in the href", () => {
    const html = renderFleetHomeHtml([siteRow({ name: "Acme", dashboardToken: 'a"b&c' })]);
    expect(html).not.toMatch(/href="[^"]*"[^"]*b&c/);
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });
});
