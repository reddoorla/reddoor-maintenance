import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";
import { renderSubmissionsPageHtml } from "../../src/dashboard/submissions-page-render.js";
import { buildSubmissionsPageModel } from "../../src/dashboard/submissions-page.js";
import type { RawFilter } from "../../src/dashboard/submissions-page.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

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

  it("gates the submit behind a client-side confirm (state-changing POST)", () => {
    const html = renderSubmissionsPageHtml(model(2));
    expect(html).toMatch(/onsubmit="return confirm\('Mark all 2 filtered new submissions/);
  });

  it("escapes filter values carried in hidden fields", () => {
    const html = renderSubmissionsPageHtml(model(3, { q: 'ada "the" <great>' }));
    expect(html).toContain('value="ada &quot;the&quot; &lt;great&gt;"');
    expect(html).not.toContain('<great>"');
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
      rawFilter: { site: "", type: "", status: "", q: "", from: "", to: "" },
      page: 1,
    });
    expect(m.markableNewCount).toBe(0);
    expect(renderSubmissionsPageHtml(m)).not.toContain('<form class="bulk-read"');
  });
});

// ---------- adapter: the POST path on the submissions-page function ----------

vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ({}) as unknown),
}));
vi.mock("../../src/reports/airtable/websites.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    listWebsites: vi.fn(async () => [{ id: "recA", name: "Site A" }]),
  };
});
vi.mock("../../src/db/client.js", () => ({
  openDb: vi.fn(async () => ({}) as unknown),
  readDbConfig: vi.fn(() => ({ url: ":memory:" })),
}));
vi.mock("../../src/db/submissions.js", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    markFilteredAsRead: vi.fn(async () => 3),
    listSubmissionsFiltered: vi.fn(async () => []),
    countSubmissionsFiltered: vi.fn(async () => 0),
    listSpamReasonsFiltered: vi.fn(async () => []),
  };
});
import { markFilteredAsRead } from "../../src/db/submissions.js";
import submissionsPage from "../../netlify/functions/submissions-page.mjs";

const markMock = vi.mocked(markFilteredAsRead);
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");
const ORIGINAL_ENV = { ...process.env };

function post(body: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request("https://dash.x/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: AUTH,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
}

const ctx = {} as unknown as Context;

describe("submissions-page adapter — bulk mark-read POST", () => {
  beforeEach(() => {
    process.env.DASHBOARD_PASSWORD = "s3cret";
    process.env.AIRTABLE_PAT = "pat";
    process.env.AIRTABLE_BASE_ID = "appX";
    process.env.TURSO_DATABASE_URL = "libsql://x";
    markMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("marks the CURRENT filter server-side and 303s back to the same view", async () => {
    const res = await submissionsPage(
      post({ action: "mark-read", site: "site-a", status: "new", q: "ada" }),
      ctx,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/submissions?site=site-a&status=new&q=ada");
    // slug resolved to the site id; raw fields re-parsed into the same SubmissionFilter
    expect(markMock).toHaveBeenCalledTimes(1);
    expect(markMock.mock.calls[0]?.[1]).toEqual({ siteId: "recA", status: "new", search: "ada" });
  });

  it("redirects to the bare page when the posted filter is empty", async () => {
    const res = await submissionsPage(post({ action: "mark-read" }), ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/submissions");
    expect(markMock.mock.calls[0]?.[1]).toEqual({});
  });

  it("403s a cross-site POST before any write", async () => {
    const res = await submissionsPage(
      post({ action: "mark-read" }, { "sec-fetch-site": "cross-site" }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(markMock).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated POST before any write", async () => {
    const req = new Request("https://dash.x/submissions", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ action: "mark-read" }).toString(),
    });
    const res = await submissionsPage(req, ctx);
    expect(res.status).toBe(401);
    expect(markMock).not.toHaveBeenCalled();
  });

  it("400s an unknown action without writing", async () => {
    const res = await submissionsPage(post({ action: "mark-everything-spam" }), ctx);
    expect(res.status).toBe(400);
    expect(markMock).not.toHaveBeenCalled();
  });

  it("404s an unknown site slug without writing", async () => {
    const res = await submissionsPage(post({ action: "mark-read", site: "no-such-site" }), ctx);
    expect(res.status).toBe(404);
    expect(markMock).not.toHaveBeenCalled();
  });

  it("405s non-GET/POST methods", async () => {
    const res = await submissionsPage(
      new Request("https://dash.x/submissions", { method: "DELETE" }),
      ctx,
    );
    expect(res.status).toBe(405);
  });

  it("GET still renders the page (regression guard for the shared parse path)", async () => {
    const res = await submissionsPage(
      new Request("https://dash.x/submissions", {
        method: "GET",
        headers: { authorization: AUTH },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No submissions match these filters.");
  });
});
