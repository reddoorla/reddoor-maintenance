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

describe("renderSubmissionsPageHtml — spam reason facets", () => {
  const spamRow = (id: string, spamReason: string | null): SubmissionView =>
    ({
      ...model().rows[0],
      id,
      status: "spam_auto",
      spamScore: 100,
      spamReason,
    }) as SubmissionView;
  const spamModel = (
    rows: SubmissionView[],
    status: "spam_auto" | "spam" | "" = "spam_auto",
  ): SubmissionsPageModel =>
    model({
      rows,
      total: rows.length,
      page: 1,
      filter: { site: "", type: "", status, q: "", from: "", to: "" },
    });
  const facetLine = (html: string): string =>
    /<div class="spam-facets muted">(.*?)<\/div>/.exec(html)?.[1] ?? "";

  it("summarizes distinct reason tokens with counts, stripping trailing :N", () => {
    const html = renderSubmissionsPageHtml(
      spamModel([
        spamRow("s1", "keywords:4,links:2"),
        spamRow("s2", "keywords:2"),
        spamRow("s3", "turnstile-required-absent"),
      ]),
    );
    const line = facetLine(html);
    expect(line).toContain("keywords ×2"); // keywords:4 and keywords:2 group as one facet
    expect(line).toContain("links ×1");
    expect(line).toContain("turnstile-required-absent ×1");
    // Most frequent facet first for at-a-glance triage.
    expect(line.indexOf("keywords ×2")).toBeLessThan(line.indexOf("links ×1"));
  });
  it("renders the facet line for the manually-marked spam bucket too", () => {
    const html = renderSubmissionsPageHtml(
      spamModel([{ ...spamRow("s1", "duplicate-body"), status: "spam" }], "spam"),
    );
    expect(facetLine(html)).toContain("duplicate-body ×1");
  });
  it("omits the facet line when the active filter is not a spam bucket", () => {
    // (the .spam-facets CSS rule is always in the stylesheet — assert on the div)
    const html = renderSubmissionsPageHtml(spamModel([spamRow("s1", "keywords:4")], ""));
    expect(html).not.toContain('<div class="spam-facets');
  });
  it("omits the facet line when no listed row carries reasons", () => {
    const html = renderSubmissionsPageHtml(spamModel([spamRow("s1", null)]));
    expect(html).not.toContain('<div class="spam-facets');
  });
  it("escapes hostile reason tokens in the facet line", () => {
    const html = renderSubmissionsPageHtml(spamModel([spamRow("s1", "<script>x</script>")]));
    expect(html).not.toContain("<script>x</script>");
    expect(facetLine(html)).toContain("&lt;script&gt;");
  });
});

describe("renderSubmissionsPageHtml — status filter", () => {
  it("offers spam_auto as a selectable status so auto-spam is reviewable", () => {
    const html = renderSubmissionsPageHtml(model());
    expect(html).toContain('value="spam_auto"');
  });
  it("marks spam_auto selected when it is the active filter", () => {
    const html = renderSubmissionsPageHtml(
      model({ filter: { site: "", type: "", status: "spam_auto", q: "", from: "", to: "" } }),
    );
    expect(html).toContain('value="spam_auto" selected');
  });
});
