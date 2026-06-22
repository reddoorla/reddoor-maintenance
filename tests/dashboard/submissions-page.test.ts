import { describe, it, expect } from "vitest";
import {
  parseSubmissionsQuery,
  buildSubmissionsPageModel,
  PAGE_SIZE,
} from "../../src/dashboard/submissions-page.js";
import type { SubmissionRow } from "../../src/reports/airtable/submissions.js";

describe("parseSubmissionsQuery", () => {
  it("parses and validates params, ignoring junk", () => {
    const p = new URLSearchParams(
      "type=contact&status=spam&q=ada&from=2026-06-01&to=2026-06-30&page=3",
    );
    const r = parseSubmissionsQuery(p);
    expect(r.filter.formType).toBe("contact");
    expect(r.filter.status).toBe("spam");
    expect(r.filter.search).toBe("ada");
    expect(r.filter.from).toBe("2026-06-01");
    expect(r.page).toBe(3);
    expect(r.siteSlug).toBe("");
  });
  it("drops invalid enum values rather than throwing", () => {
    const r = parseSubmissionsQuery(new URLSearchParams("type=bogus&status=nope&page=-4"));
    expect(r.filter.formType).toBeUndefined();
    expect(r.filter.status).toBeUndefined();
    expect(r.page).toBe(1);
  });
  it("captures the site slug for the handler to resolve", () => {
    expect(parseSubmissionsQuery(new URLSearchParams("site=erp-industrials")).siteSlug).toBe(
      "erp-industrials",
    );
  });
});

describe("buildSubmissionsPageModel", () => {
  const rows: SubmissionRow[] = [
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
    },
  ];
  const sites = [
    { id: "recA", name: "Site A" },
    { id: "recB", name: "Site B" },
  ];

  it("enriches rows with site name + slug and computes pagination", () => {
    const model = buildSubmissionsPageModel({
      rows,
      total: 120,
      sites,
      filter: { siteId: "recA" },
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "" },
      page: 2,
    });
    expect(model.rows[0]?.siteName).toBe("Site A");
    expect(model.rows[0]?.slug).toBe("site-a");
    expect(model.page).toBe(2);
    expect(model.pageSize).toBe(PAGE_SIZE);
    expect(model.total).toBe(120);
    expect(model.sites.map((s) => s.slug)).toContain("site-a");
  });
  it("falls back to the raw site_id when no matching site is known", () => {
    const ghost = rows[0];
    if (!ghost) throw new Error("fixture missing");
    const model = buildSubmissionsPageModel({
      rows: [{ ...ghost, siteId: "recGHOST" }],
      total: 1,
      sites,
      filter: {},
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "" },
      page: 1,
    });
    expect(model.rows[0]?.siteName).toBe("recGHOST");
    expect(model.rows[0]?.slug).toBe("");
  });
});
