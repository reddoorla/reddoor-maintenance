import { describe, it, expect } from "vitest";
import { renderSubmissionsPageHtml } from "../../src/dashboard/submissions-page-render.js";
import type { SubmissionsPageModel, SubmissionView } from "../../src/dashboard/submissions-page.js";

function model(over: Partial<SubmissionsPageModel> = {}): SubmissionsPageModel {
  return {
    rows: [
      {
        id: "sub_1",
        submissionId: 1,
        siteId: "recA",
        formType: "contact",
        name: "Ada",
        email: "a@x.com",
        phone: null,
        message: null,
        extraFields: null,
        sourceUrl: null,
        utm: null,
        submittedAt: "2026-06-20T00:00:00.000Z",
        status: "new",
        notifyStatus: "sent",
        resendMessageId: null,
        siteName: "Site A",
        slug: "site-a",
      },
    ],
    sites: [
      { slug: "site-a", name: "Site A" },
      { slug: "site-b", name: "Site B" },
    ],
    filter: { site: "", type: "contact", status: "", q: "", from: "", to: "" },
    page: 2,
    pageSize: 50,
    total: 120,
    ...over,
  };
}

describe("renderSubmissionsPageHtml", () => {
  it("renders the filter form with active values selected", () => {
    const html = renderSubmissionsPageHtml(model());
    expect(html).toContain("<form");
    expect(html).toContain('value="contact"'); // active type reflected
    expect(html).toContain('name="q"');
    expect(html).toContain("Site A");
    expect(html).toContain("/s/site-a"); // each row links to its site
  });
  it("shows pagination that preserves filters and clamps edges", () => {
    const html = renderSubmissionsPageHtml(model({ page: 2, total: 120, pageSize: 50 }));
    expect(html).toMatch(/page=1/); // prev → page 1
    expect(html).toMatch(/page=3/); // next → page 3
    expect(html).toContain("type=contact"); // filter preserved in links
  });
  it("renders an empty state when total is 0", () => {
    const html = renderSubmissionsPageHtml(model({ rows: [], total: 0 }));
    expect(html.toLowerCase()).toContain("no submissions");
  });
  it("guards a page-beyond-last request (empty rows, total>0) instead of an empty list + impossible pager", () => {
    // total 120, pageSize 50 → maxPage 3. Asking for page 5 yields zero rows.
    const html = renderSubmissionsPageHtml(model({ rows: [], total: 120, page: 5, pageSize: 50 }));
    expect(html).not.toContain('<ul class="subm-list"></ul>'); // no empty list
    expect(html).not.toMatch(/Page 5 of 3/); // no impossible pager
    expect(html.toLowerCase()).toContain("page 5"); // tells the operator they overshot
    expect(html).toMatch(/page=3/); // offers a link back to the last real page
  });
  it("includes the status script + escapes hostile site names", () => {
    const html = renderSubmissionsPageHtml(
      model({
        rows: [{ ...model().rows[0], siteName: "<script>x</script>", slug: "x" } as SubmissionView],
      }),
    );
    expect(html).toContain("button.subm-status");
    expect(html).not.toContain("<script>x</script>");
  });
});
