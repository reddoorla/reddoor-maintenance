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
/**
 * `<script ...>` with ANY attributes, not just the bare tag. The original pattern
 * was `<script>`, so the day someone writes `<script type="module">` or adds a
 * nonce the gate would skip that block in silence — a gate that stops looking is
 * worse than no gate, because it still reports green.
 *
 * `src=`-only tags carry no body and are excluded rather than compiled as "".
 */
function inlineScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .filter((src) => src.trim() !== "");
}

/**
 * Inline event-handler attributes (`onclick="…"`, `onsubmit="…"`) are JavaScript
 * too, and the `<script>` sweep cannot see them — `submissions-page-render.ts`
 * ships one. Their bodies are HTML-attribute-encoded, so they have to be decoded
 * before they will parse.
 */
function inlineHandlers(html: string): { attr: string; src: string }[] {
  return [...html.matchAll(/\bon([a-z]+)\s*=\s*"([^"]*)"/g)].map((m) => ({
    attr: `on${m[1]!}`,
    src: m[2]!
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  }));
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
  // Inline handler attributes are the other half of the page's JavaScript, and a
  // broken one fails only for the control it is on — quieter than a dead script
  // block, and invisible to the sweep above.
  for (const { attr, src } of inlineHandlers(html)) {
    expect(
      () => new Function(src),
      `${label}: inline ${attr}="…" does not parse — that control is dead`,
    ).not.toThrow();
  }
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

// Prove the instrument before trusting its verdict: each of these is a state the
// gate MUST report, and two of them are states it used to miss entirely.
describe("the parse gate itself", () => {
  it("sees a script tag that carries attributes, not only the bare form", () => {
    expect(inlineScripts('<script type="module">const a = 1;</script>')).toEqual(["const a = 1;"]);
    expect(inlineScripts("<script>const a = 1;</script>")).toEqual(["const a = 1;"]);
  });

  it("fails a broken script inside an attributed tag", () => {
    // Under the old `<script>`-only pattern this block was skipped and the page
    // reported green with a dead script element.
    expect(() =>
      expectAllScriptsParse('<script nonce="x">const a = "unterminated</script>', "probe"),
    ).toThrow();
  });

  it("sees inline handler attributes, and decodes them before parsing", () => {
    const found = inlineHandlers(`<form onsubmit="go(&quot;a&quot;); return false">`);
    expect(found).toEqual([{ attr: "onsubmit", src: 'go("a"); return false' }]);
  });

  it("fails a broken inline handler", () => {
    expect(() =>
      expectAllScriptsParse(
        '<script>const ok = 1;</script><button onclick="doThing(">x</button>',
        "probe",
      ),
    ).toThrow();
  });

  it("passes a page whose script and handler are both valid", () => {
    // The positive control. Without it every assertion above would be satisfied by
    // a gate that simply threw on everything.
    expect(() =>
      expectAllScriptsParse(
        '<script>const ok = 1;</script><form onsubmit="go(&quot;a&quot;); return false"></form>',
        "probe",
      ),
    ).not.toThrow();
  });

  it("does not count a src-only script tag as an empty block", () => {
    expect(inlineScripts('<script src="/x.js"></script>')).toEqual([]);
  });
});

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
