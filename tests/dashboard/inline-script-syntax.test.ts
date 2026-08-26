import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { renderSubmissionsPageHtml } from "../../src/dashboard/submissions-page-render.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { gatingFields } from "../../src/reports/checklist.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { SubmissionsPageModel } from "../../src/dashboard/submissions-page.js";
import { renderProspectAuditsPageHtml } from "../../src/dashboard/prospect-audits-render.js";

/**
 * Every dashboard page ships its interactivity as ONE inline <script> block. A single
 * syntax error anywhere in that block is not a partial failure — the browser refuses to
 * parse the whole thing, so EVERY handler silently fails to attach and the page turns
 * into a static document that still looks completely normal.
 *
 * That is exactly what shipped: `b.title = data.blockers.join("\n")` was written inside
 * the renderer's template literal, so `\n` was interpolated at BUILD time into a real
 * newline — emitting an unterminated string literal into the served HTML. Approve,
 * "Send anyway…", Trigger Renovate and the site-details selects were all dead on the
 * per-site dashboard, with no error visible anywhere in the product.
 *
 * `new Function(src)` compiles the body WITHOUT executing it, so this asserts pure
 * parseability — no DOM, no jsdom, no network. Any escape sequence that has to survive
 * into the browser must be double-escaped in the template literal, and this test is what
 * says so out loud when it isn't.
 */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

function expectAllScriptsParse(html: string, label: string): void {
  const blocks = inlineScripts(html);
  // A renderer that stops emitting its script block would make this test vacuously
  // green — assert the surface actually exists before asserting it parses.
  expect(blocks.length, `${label} emitted no inline <script> to check`).toBeGreaterThan(0);
  blocks.forEach((src, i) => {
    expect(
      () => new Function(src),
      `${label}: inline <script> block ${i} does not parse — every handler on the page is dead`,
    ).not.toThrow();
  });
}

const NOW = new Date("2026-07-30T12:00:00.000Z");

const healthCleanEvidence = (type: ReportRow["reportType"]) =>
  Object.fromEntries(
    gatingFields(type).map((f) => [
      f,
      { result: "pass" as const, checkedAt: "2026-07-30T00:00:00.000Z", note: "ok" },
    ]),
  );

const site = makeWebsiteRow({
  name: "Acme Co",
  pointOfContact: "owner@acme.example",
  headerImage: { url: "https://x/y.jpg", filename: "y.jpg", type: "image/jpeg" },
});

/** A pending-approval report — the state that renders the approve button, the
 *  checklist and (when health is red) the override control. */
const pendingReport = {
  id: "recPending",
  reportId: "Acme Co — Maintenance — 2026-07-30",
  siteId: site.id,
  reportType: "Maintenance",
  period: "2026-07",
  periodStart: "2026-06-30",
  periodEnd: "2026-07-30",
  completedOn: "2026-07-30",
  lighthouse: { performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
  lastTestedDate: null,
  draftReady: true,
  approvedToSend: false,
  sentAt: null,
  deliveryStatus: "pending",
  renderedHtmlAttachment: null,
  resendMessageId: null,
  commentary: null,
  subjectOverride: null,
  gaUsersCurrent: null,
  gaUsersPrevious: null,
  searchFoundPage1: null,
  searchPosition: null,
  checklist: {},
  autoEvidence: healthCleanEvidence("Maintenance"),
  sendOverride: false,
  overrideReason: null,
} as unknown as ReportRow;

/** Same report with a RED health gate, so the override control ("Send anyway…")
 *  and its own handlers are in the rendered output too. */
const healthRedReport = {
  ...pendingReport,
  id: "recRed",
  autoEvidence: {
    ...healthCleanEvidence("Maintenance"),
    "Maint: Uptime Checked": {
      result: "fail" as const,
      checkedAt: "2026-07-30T00:00:00.000Z",
      note: 'a route returned "500"',
    },
  },
} as unknown as ReportRow;

const submissionsModel: SubmissionsPageModel = {
  rows: [],
  sites: [{ slug: "acme-co", name: "Acme Co" }],
  filter: { site: "", type: "", status: "", q: "", from: "", to: "", reason: "" },
  page: 1,
  pageSize: 50,
  total: 0,
  facetReasons: [],
  markableNewCount: 0,
} as unknown as SubmissionsPageModel;

describe("dashboard inline <script> blocks parse", () => {
  it("site dashboard — the page that carries approve/override/renovate handlers", () => {
    expectAllScriptsParse(
      renderSiteDashboardHtml(site, [pendingReport], [], null, NOW, null),
      "site dashboard",
    );
  });

  it("site dashboard with a red health gate (override control rendered)", () => {
    expectAllScriptsParse(
      renderSiteDashboardHtml(site, [healthRedReport], [], null, NOW, null),
      "site dashboard (health red)",
    );
  });

  it("fleet cockpit", () => {
    const model = buildCockpitModel(
      [site],
      [pendingReport],
      {},
      "https://reddoor-maintenance.netlify.app",
      NOW,
    );
    expectAllScriptsParse(renderCockpitHtml(model), "fleet cockpit");
  });

  it("submissions page", () => {
    expectAllScriptsParse(renderSubmissionsPageHtml(submissionsModel), "submissions page");
  });

  // The prospect-audits page ships a 50-line RUN_SCRIPT whose own header comment
  // cites the build-time-`\n` incident this gate exists to catch — and it was the
  // one dashboard page the gate never covered.
  it("prospect audits page — empty", () => {
    expectAllScriptsParse(
      renderProspectAuditsPageHtml({ audits: [], now: NOW }),
      "prospect audits (empty)",
    );
  });

  it("prospect audits page — with a listed audit", () => {
    // A populated list interpolates operator-supplied strings (business name, URL)
    // into the markup around the script; the empty case never exercises that.
    expectAllScriptsParse(
      renderProspectAuditsPageHtml({
        audits: [
          {
            id: "pa_1",
            token: "tok_abc",
            url: "https://example.com/a'b",
            business: `O'Brien & Sons "Ltd"`,
            created_at: "2026-08-25T10:00:00.000Z",
            status: "complete",
          },
        ],
        now: NOW,
        operatorEmail: "contact@tuckerlemos.com",
      }),
      "prospect audits (populated)",
    );
  });
});
