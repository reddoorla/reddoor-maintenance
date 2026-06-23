import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";
import { siteSlug } from "../../src/reports/airtable/websites.js";

describe("renderSiteDashboardHtml — submissions", () => {
  it("omits the section when there are no submissions", () => {
    const html = renderSiteDashboardHtml(makeWebsiteRow(), []);
    expect(html).not.toContain("Form submissions");
  });

  it("lists submissions with escaped content and status buttons", () => {
    const html = renderSiteDashboardHtml(
      makeWebsiteRow(),
      [],
      [
        makeSubmissionRow({
          id: "recSUB",
          formType: "contact",
          name: "Jane <x>",
          email: "jane@x.com",
          message: "Hi & bye",
          status: "new",
        }),
      ],
    );
    expect(html).toContain("Form submissions (1)");
    expect(html).toContain("Jane &lt;x&gt;");
    expect(html).toContain("Hi &amp; bye");
    expect(html).toContain('data-url="/api/submissions/recSUB/status"');
    expect(html).toContain('data-status="archived"');
    expect(html).toContain("pill subm-new");
  });

  const site = makeWebsiteRow();
  const reports: never[] = [];
  const submissions = [makeSubmissionRow({ id: "recSUB", formType: "contact", status: "new" })];
  const spamTotals = { honeypot: 1, tooFast: 0, markedSpam: 0 };

  it("places spam + submissions below site details", () => {
    const html = renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date());
    const detailsIdx = html.indexOf('class="section site-details"');
    const spamIdx = html.indexOf('class="section spam-screen"');
    const submIdx = html.indexOf('class="section submissions"');
    expect(detailsIdx).toBeGreaterThan(-1);
    expect(spamIdx).toBeGreaterThan(-1);
    expect(submIdx).toBeGreaterThan(-1);
    expect(detailsIdx).toBeLessThan(spamIdx); // site details before spam screen
    expect(spamIdx).toBeLessThan(submIdx); // spam screen, then submissions dead last
  });

  it("links the submissions heading to the filtered /submissions page", () => {
    const html = renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date());
    expect(html).toContain(`/submissions?site=${siteSlug(site.name)}`);
  });
});
