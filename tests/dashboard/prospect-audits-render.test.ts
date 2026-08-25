import { describe, it, expect } from "vitest";
import {
  renderProspectAuditsPageHtml,
  type ProspectAuditsPageModel,
} from "../../src/dashboard/prospect-audits-render.js";
import type { ProspectAuditListItem } from "../../src/db/prospect-audits.js";

function item(over: Partial<ProspectAuditListItem> = {}): ProspectAuditListItem {
  return {
    id: "pa_1",
    token: "A".repeat(22),
    url: "https://acme.example/",
    business: "Acme Roofing",
    status: "complete",
    created_at: "2026-08-25T12:00:00.000Z",
    ...over,
  };
}

const NOW = new Date("2026-08-25T12:10:00.000Z");

function model(over: Partial<ProspectAuditsPageModel> = {}): ProspectAuditsPageModel {
  return { audits: [], now: NOW, ...over };
}

describe("renderProspectAuditsPageHtml", () => {
  it("renders the run form with a URL field and a Run button", () => {
    const html = renderProspectAuditsPageHtml(model());
    expect(html).toContain('id="audit-run-form"');
    expect(html).toContain('name="url"');
    expect(html).toContain('type="url"');
    expect(html).toContain("Run audit");
  });

  it("says plainly that the answer arrives by email — no spinner promise", () => {
    const html = renderProspectAuditsPageHtml(model());
    expect(html).toMatch(/arrives by email/i);
  });

  it("renders the empty state when there are no audits", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [] }));
    expect(html).toContain("No audits yet");
  });

  it("renders a seeded row: business, url, status, and a link to /r/{token}", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [item()] }));
    expect(html).toContain("Acme Roofing");
    expect(html).toContain("https://acme.example/");
    expect(html).toContain("Complete");
    expect(html).toContain(`/r/${"A".repeat(22)}`);
  });

  it("labels a partial audit distinctly from a complete one", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [item({ status: "partial" })] }));
    expect(html).toContain("Partial");
    expect(html).not.toContain(">Complete<");
  });

  it("escapes a hostile business name instead of injecting it", () => {
    const hostile = '<img src=x onerror=alert(1)>Acme "Evil" & Co';
    const html = renderProspectAuditsPageHtml(model({ audits: [item({ business: hostile })] }));
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;Evil&quot;");
    expect(html).toContain("&amp; Co");
  });

  it("shows a neutral placeholder when business is null, without a raw null", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [item({ business: null })] }));
    expect(html).toContain("no business name");
    expect(html).not.toContain(">null<");
  });

  it("renders the audited url as a safe, clickable link", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [item()] }));
    expect(html).toContain('href="https://acme.example/"');
  });

  it("never turns a non-http(s) audited url into a clickable href", () => {
    const html = renderProspectAuditsPageHtml(
      model({ audits: [item({ url: "javascript:alert(1)" })] }),
    );
    expect(html).not.toContain('href="javascript:alert(1)"');
    // Still shown as text so the row isn't silently blank.
    expect(html).toContain("javascript:alert(1)");
  });

  it("omits the report link for a malformed (non-token-shaped) token", () => {
    const html = renderProspectAuditsPageHtml(model({ audits: [item({ token: "not-a-token" })] }));
    expect(html).not.toContain("/r/not-a-token");
    expect(html).toContain("Report unavailable");
  });

  it("renders multiple rows in the order given", () => {
    const html = renderProspectAuditsPageHtml(
      model({
        audits: [
          item({ id: "pa_1", business: "First Co", token: "A".repeat(22) }),
          item({ id: "pa_2", business: "Second Co", token: "B".repeat(22) }),
        ],
      }),
    );
    expect(html.indexOf("First Co")).toBeLessThan(html.indexOf("Second Co"));
  });
});
