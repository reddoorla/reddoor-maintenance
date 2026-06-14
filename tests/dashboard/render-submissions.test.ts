import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

describe("renderSiteDashboardHtml — submissions", () => {
  it("omits the section when there are no submissions", () => {
    const html = renderSiteDashboardHtml(makeWebsiteRow(), []);
    expect(html).not.toContain("Form submissions");
  });

  it("lists submissions with escaped content and status buttons", () => {
    const html = renderSiteDashboardHtml(makeWebsiteRow(), [], [
      makeSubmissionRow({
        id: "recSUB",
        formType: "contact",
        name: "Jane <x>",
        email: "jane@x.com",
        message: "Hi & bye",
        status: "new",
      }),
    ]);
    expect(html).toContain("Form submissions (1)");
    expect(html).toContain("Jane &lt;x&gt;");
    expect(html).toContain("Hi &amp; bye");
    expect(html).toContain('data-url="/api/submissions/recSUB/status"');
    expect(html).toContain('data-status="archived"');
    expect(html).toContain("pill subm-new");
  });
});
