import { describe, it, expect } from "vitest";
import { renderSubmissionsPageHtml } from "./render.js";
import { buildSubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";
import type { RawFilter } from "../../../src/dashboard/submissions-page.js";
import type { SubmissionRow } from "../../../src/reports/submission-row.js";

// ---------- render: the bulk "Mark all N filtered as read" form ----------

const row: SubmissionRow = {
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
};
const sites = [{ id: "recA", name: "Site A" }];

function model(markableNewCount: number, rawOverrides: Partial<RawFilter> = {}) {
  const rawFilter: RawFilter = {
    site: "",
    type: "",
    status: "new",
    q: "",
    from: "",
    to: "",
    reason: "",
    ...rawOverrides,
  };
  return buildSubmissionsPageModel({
    rows: [row],
    total: 104,
    sites,
    filter: { status: "new" },
    rawFilter,
    page: 1,
    markableNewCount,
  });
}

describe("renderSubmissionsPageHtml — bulk mark-read form", () => {
  it("renders the button with the still-'new' count and POSTs back to /submissions", () => {
    const html = renderSubmissionsPageHtml(model(104));
    expect(html).toContain("Mark all 104 filtered as read");
    expect(html).toMatch(/<form class="bulk-read" method="post" action="\/submissions"/);
    expect(html).toContain('name="action" value="mark-read"');
    // the ACTIVE filter rides along as hidden fields
    expect(html).toContain('name="status" value="new"');
  });

  // "gates the submit behind a client-side confirm (state-changing POST)": its behaviour is the DOM tests' now (submissions.dom: the bulk confirm).
  it("escapes filter values carried in hidden fields", () => {
    const html = renderSubmissionsPageHtml(model(3, { q: 'ada "the" <great>' }));
    expect(html).toContain('value="ada &quot;the&quot; &lt;great>"');
    expect(html).not.toContain('<great>"');
  });

  it("carries the active reason filter as a hidden field (bulk POST must flip the SHOWN bucket)", () => {
    const html = renderSubmissionsPageHtml(model(3, { reason: "turnstile-required-absent" }));
    expect(html).toContain('name="reason" value="turnstile-required-absent"');
  });

  it("omits the reason hidden field when no reason filter is active", () => {
    const html = renderSubmissionsPageHtml(model(3));
    expect(html).not.toContain('name="reason"');
  });

  it("renders NO bulk form when the bucket has no still-'new' rows", () => {
    // the .bulk-read CSS rule is always in the stylesheet — assert on the markup
    const html = renderSubmissionsPageHtml(model(0));
    expect(html).not.toContain('<form class="bulk-read"');
    expect(html).not.toContain("mark-read");
  });

  it("defaults markableNewCount to 0 when the model builder isn't given one", () => {
    const m = buildSubmissionsPageModel({
      rows: [row],
      total: 1,
      sites,
      filter: {},
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "", reason: "" },
      page: 1,
    });
    expect(m.markableNewCount).toBe(0);
    expect(renderSubmissionsPageHtml(m)).not.toContain('<form class="bulk-read"');
  });
});
