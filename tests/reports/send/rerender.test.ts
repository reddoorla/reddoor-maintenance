import { describe, it, expect } from "vitest";
import {
  rerenderReport,
  formatRerenderResult,
  type RerenderDeps,
} from "../../../src/reports/send/rerender.js";
import { makeWebsiteRow } from "../../_helpers/website-row.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";

/**
 * On-demand refresh of a report's stored body (#539 Phase 4).
 *
 * The operator edits commentary, asks for a preview, and this regenerates the
 * body through the SAME renderer the send uses. It runs in Actions rather than
 * in a Netlify function on purpose: rendering needs sharp, a native module that
 * is not currently bundled into any function, and a design firm's preview has to
 * be pixel-exact rather than approximated to avoid it.
 */
const SITE = makeWebsiteRow({
  id: "recSITE",
  name: "Acme Co",
  headerImage: {
    url: "https://files.example/signed/plate.jpg",
    filename: "p.jpg",
    type: "image/jpeg",
  },
});

const NOW = new Date("2026-09-28T12:00:00.000Z");
const CHECKED = "2026-09-27T13:40:57.211Z";
const NOT_MEASURED = { result: "unknown", checkedAt: null, note: "Not yet measured" } as const;
const GATING = [
  "Maint: Deploy & Function Health",
  "Maint: CMS Checked",
  "Maint: Domain, DNS & SSL",
  "Maint: Security Updates",
  "Maint: Uptime Checked",
];

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "ACME-M",
    siteId: "recSITE",
    reportType: "Maintenance",
    sentAt: null,
    approvedToSend: false,
    checklist: {},
    autoEvidence: {},
    ...over,
  } as ReportRow;
}

const MEASURED_SITE = makeWebsiteRow({
  ...SITE,
  url: "https://acme.com",
  netlifyId: "n1",
  deployStatus: "ready",
  deployCheckedAt: CHECKED,
  functionHealth: "pass",
  cmsReachable: "pass",
  functionHealthCheckedAt: CHECKED,
  certDaysRemaining: 80,
  domainCheckedAt: CHECKED,
  securityVulnsCritical: 0,
  securityVulnsHigh: 0,
  lastSecurityAuditAt: CHECKED,
  reachableOk: "pass",
  browserCheckedAt: CHECKED,
});

const FROZEN = report({
  autoEvidence: Object.fromEntries(GATING.map((f) => [f, NOT_MEASURED])),
});

function deps(over: Partial<RerenderDeps> = {}): RerenderDeps {
  return {
    getReport: async () => report(),
    getSite: async () => SITE,
    loadHeaderPlate: async () => new Uint8Array([9, 9, 9]),
    render: async () => ({ html: "<html>rendered</html>" }),
    store: async () => {},
    storeEvidence: async () => true,
    storeScores: async () => true,
    now: () => NOW,
    ...over,
  };
}

describe("rerenderReport", () => {
  it("renders from the current row and stores the result", async () => {
    const stored: Array<{ id: string; html: string }> = [];
    const r = await rerenderReport(
      deps({ store: async (id, html) => void stored.push({ id, html }) }),
      "recREP",
    );
    expect(r.status).toBe("rendered");
    expect(stored).toEqual([{ id: "recREP", html: "<html>rendered</html>" }]);
  });

  it("renders with the header plate stored in Turso", async () => {
    const seen: Uint8Array[] = [];
    const r = await rerenderReport(
      deps({
        render: async (_s, _r, plate) => {
          seen.push(plate);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", headerSource: "turso" });
    expect(seen[0]).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("is no-header when Turso has no plate, even if the site row still names an attachment", async () => {
    let rendered = false;
    let stored = false;
    const r = await rerenderReport(
      deps({
        loadHeaderPlate: async () => null,
        render: async () => {
          rendered = true;
          return { html: "x" };
        },
        store: async () => void (stored = true),
      }),
      "recREP",
    );
    expect(SITE.headerImage).not.toBeNull();
    expect(r.status).toBe("no-header");
    expect(rendered).toBe(false);
    expect(stored).toBe(false);
  });

  it("REFUSES to re-render a report that has been sent", async () => {
    // The stored body of a sent report is the record of what the client
    // received. Regenerating it would overwrite that record with something the
    // client never saw — and today's data would not even reproduce it.
    let stored = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ sentAt: "2026-08-20T09:00:00.000Z" }),
        store: async () => void (stored = true),
      }),
      "recREP",
    );
    expect(r.status).toBe("already-sent");
    expect(stored).toBe(false);
  });

  it("reports a site with no header image instead of rendering a broken one", async () => {
    const r = await rerenderReport(
      deps({
        getSite: async () => makeWebsiteRow({ id: "recSITE", name: "Acme Co", headerImage: null }),
        loadHeaderPlate: async () => null,
      }),
      "recREP",
    );
    expect(r.status).toBe("no-header");
  });

  it("returns not-found for an unknown report, and for a report whose site is missing", async () => {
    expect((await rerenderReport(deps({ getReport: async () => null }), "recNOPE")).status).toBe(
      "not-found",
    );
    expect((await rerenderReport(deps({ getSite: async () => null }), "recREP")).status).toBe(
      "not-found",
    );
  });
});

describe("rerenderReport — health evidence (#890)", () => {
  it("re-checks a frozen draft's evidence against current health, stores it, and renders from it", async () => {
    const written: Array<{ id: string; evidence: Record<string, { result: string }> }> = [];
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => FROZEN,
        getSite: async () => MEASURED_SITE,
        storeEvidence: async (id, _c, evidence) => {
          written.push({ id, evidence });
          return true;
        },
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", evidence: "reticked" });
    expect(written).toHaveLength(1);
    for (const f of GATING) expect(written[0]!.evidence[f]!.result).toBe("pass");
    expect(rendered[0]!.autoEvidence![GATING[0]!]!.result).toBe("pass");
  });

  it("never touches the evidence of an approved report", async () => {
    let wrote = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => ({ ...FROZEN, approvedToSend: true }),
        getSite: async () => MEASURED_SITE,
        storeEvidence: async () => (wrote = true),
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", evidence: "locked" });
    expect(wrote).toBe(false);
  });

  it("renders from the row it read when the conditional write matched nothing", async () => {
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => FROZEN,
        getSite: async () => MEASURED_SITE,
        storeEvidence: async () => false,
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", evidence: "not-written" });
    expect(rendered[0]!.autoEvidence![GATING[0]!]!.result).toBe("unknown");
  });

  it("names the evidence outcome on the machine-greppable line", () => {
    expect(
      formatRerenderResult({
        status: "rendered",
        reportId: "recREP",
        bytes: 10,
        headerSource: "turso",
        evidence: "reticked",
        search: "skipped",
        scores: "unchanged",
        scoresChange: null,
      }),
    ).toBe(
      "REPORT_RERENDER report=recREP status=rendered bytes=10 header=turso evidence=reticked search=skipped scores=unchanged",
    );
  });
});

describe("rerenderReport — Google Indexed re-measure", () => {
  const ENROLLED = makeWebsiteRow({
    ...MEASURED_SITE,
    searchConsoleProperty: "https://acme.com/",
  });
  const GOOGLE = "Maint: Google Indexed";
  const TESTING = report({
    reportType: "Testing",
    periodStart: "2026-08-31",
    periodEnd: "2026-09-30",
    autoEvidence: { [GOOGLE]: NOT_MEASURED },
    checklist: { [GOOGLE]: false },
    searchFoundPage1: null,
    searchPosition: null,
  });
  const PAGE_1 = {
    value: { foundOnPage1: true, position: 2, propertyFound: true },
    softFailed: false,
    notConfigured: false,
  };

  it("measures an unapproved draft over its own period, stores evidence and columns together, and renders them", async () => {
    const calls: Array<[string, string]> = [];
    const written: Array<{ evidence: Record<string, { result: string }>; search: unknown }> = [];
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => TESTING,
        getSite: async () => ENROLLED,
        measureSearch: async (_s, start, end) => {
          calls.push([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]);
          return PAGE_1;
        },
        storeEvidence: async (_id, _c, evidence, search) => {
          written.push({ evidence, search });
          return true;
        },
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", evidence: "reticked", search: "measured" });
    expect(calls).toEqual([["2026-08-31", "2026-09-30"]]);
    expect(written[0]!.evidence[GOOGLE]!.result).toBe("pass");
    expect(written[0]!.search).toEqual({ searchFoundPage1: true, searchPosition: 2 });
    expect(rendered[0]!.searchFoundPage1).toBe(true);
    expect(rendered[0]!.searchPosition).toBe(2);
    expect(rendered[0]!.checklist[GOOGLE]).toBe(true);
  });

  it("never measures an approved report", async () => {
    let measured = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => ({ ...TESTING, approvedToSend: true }),
        getSite: async () => ENROLLED,
        measureSearch: async () => {
          measured = true;
          return PAGE_1;
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", evidence: "locked", search: "skipped" });
    expect(measured).toBe(false);
  });

  it("never measures a site that opted out of Search Console", async () => {
    let measured = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => TESTING,
        getSite: async () =>
          makeWebsiteRow({ ...ENROLLED, acceptedWatchConditions: ["no search console"] }),
        measureSearch: async () => {
          measured = true;
          return PAGE_1;
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", search: "skipped" });
    expect(measured).toBe(false);
  });

  it("stores a soft-fail as unknown and leaves the search columns alone", async () => {
    const written: Array<{ evidence: Record<string, { result: string }>; search: unknown }> = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => TESTING,
        getSite: async () => ENROLLED,
        measureSearch: async () => ({ value: null, softFailed: true, notConfigured: false }),
        storeEvidence: async (_id, _c, evidence, search) => {
          written.push({ evidence, search });
          return true;
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", search: "unavailable" });
    expect(written[0]!.evidence[GOOGLE]!.result).toBe("unknown");
    expect(written[0]!.search).toBeNull();
  });

  it("never measures a report with no period, which would query an empty 1970 window", async () => {
    let measured = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => ({ ...TESTING, periodStart: null }),
        getSite: async () => ENROLLED,
        measureSearch: async () => {
          measured = true;
          return PAGE_1;
        },
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", search: "skipped" });
    expect(measured).toBe(false);
  });

  it("says unavailable, not measured, when the environment has no Search Console credentials", async () => {
    const r = await rerenderReport(
      deps({
        getReport: async () => TESTING,
        getSite: async () => ENROLLED,
        measureSearch: async () => ({ value: null, softFailed: false, notConfigured: true }),
      }),
      "recREP",
    );
    expect(r).toMatchObject({ status: "rendered", search: "unavailable" });
  });

  it("names the search outcome on the no-header line too", () => {
    expect(
      formatRerenderResult({
        status: "no-header",
        reportId: "recREP",
        evidence: "unchanged",
        search: "unavailable",
        scores: "site-missing",
        scoresChange: null,
      }),
    ).toBe(
      "REPORT_RERENDER report=recREP status=no-header evidence=unchanged search=unavailable scores=site-missing",
    );
  });

  it("names the search outcome on the machine-greppable line", () => {
    expect(
      formatRerenderResult({
        status: "rendered",
        reportId: "recREP",
        bytes: 10,
        headerSource: "turso",
        evidence: "reticked",
        search: "measured",
        scores: "unchanged",
        scoresChange: null,
      }),
    ).toBe(
      "REPORT_RERENDER report=recREP status=rendered bytes=10 header=turso evidence=reticked search=measured scores=unchanged",
    );
  });
});

describe("rerenderReport — Lighthouse scores (P1-34)", () => {
  const STORED = { performance: 93, accessibility: 100, bestPractices: 78, seo: 100 };
  const LIVE_SITE = makeWebsiteRow({
    ...SITE,
    pScore: 100,
    rScore: 100,
    bpScore: 100,
    seoScore: 100,
  });

  it("writes the site row's current scores to an unsent, unapproved report and renders with them", async () => {
    const written: Array<{ id: string; scores: unknown }> = [];
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: STORED }),
        getSite: async () => LIVE_SITE,
        storeScores: async (id, scores) => {
          written.push({ id, scores });
          return true;
        },
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    const live = { performance: 100, accessibility: 100, bestPractices: 100, seo: 100 };
    expect(written).toEqual([{ id: "recREP", scores: live }]);
    expect(rendered[0]!.lighthouse).toEqual(live);
    expect(r).toMatchObject({
      status: "rendered",
      scores: "refreshed",
      scoresChange: "p:93→100,bp:78→100",
    });
  });

  it("names the score change on the machine-greppable line", () => {
    expect(
      formatRerenderResult({
        status: "rendered",
        reportId: "recREP",
        bytes: 10,
        headerSource: "turso",
        evidence: "unchanged",
        search: "skipped",
        scores: "refreshed",
        scoresChange: "bp:78→100",
      }),
    ).toBe(
      "REPORT_RERENDER report=recREP status=rendered bytes=10 header=turso evidence=unchanged search=skipped scores=refreshed scores_change=bp:78→100",
    );
  });

  it("never touches the scores of an approved report", async () => {
    let wrote = false;
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: STORED, approvedToSend: true }),
        getSite: async () => LIVE_SITE,
        storeScores: async () => (wrote = true),
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(wrote).toBe(false);
    expect(rendered[0]!.lighthouse).toEqual(STORED);
    expect(r).toMatchObject({ status: "rendered", scores: "locked", scoresChange: null });
  });

  it("leaves the stored scores alone, and says so, when the site row is missing a score", async () => {
    let wrote = false;
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: STORED }),
        getSite: async () => makeWebsiteRow({ ...LIVE_SITE, bpScore: null }),
        storeScores: async () => (wrote = true),
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(wrote).toBe(false);
    expect(rendered[0]!.lighthouse).toEqual(STORED);
    expect(r).toMatchObject({ status: "rendered", scores: "site-missing", scoresChange: null });
  });

  it("fills a row whose stored scores read as none, and says so once", async () => {
    let wrote = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: null }),
        getSite: async () => LIVE_SITE,
        storeScores: async () => (wrote = true),
      }),
      "recREP",
    );
    expect(wrote).toBe(true);
    expect(r).toMatchObject({
      status: "rendered",
      scores: "refreshed",
      scoresChange: "none→p:100,a:100,bp:100,seo:100",
    });
  });

  it("writes nothing when the stored scores already match the site row", async () => {
    let wrote = false;
    const live = { performance: 100, accessibility: 100, bestPractices: 100, seo: 100 };
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: live }),
        getSite: async () => LIVE_SITE,
        storeScores: async () => (wrote = true),
      }),
      "recREP",
    );
    expect(wrote).toBe(false);
    expect(r).toMatchObject({ status: "rendered", scores: "unchanged", scoresChange: null });
  });

  it("renders the scores it read when the conditional write matched nothing", async () => {
    const rendered: ReportRow[] = [];
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: STORED }),
        getSite: async () => LIVE_SITE,
        storeScores: async () => false,
        render: async (_s, rep) => {
          rendered.push(rep);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(rendered[0]!.lighthouse).toEqual(STORED);
    expect(r).toMatchObject({ status: "rendered", scores: "not-written", scoresChange: null });
  });

  it("refreshes the scores before naming a missing header, as the evidence does", async () => {
    let wrote = false;
    const r = await rerenderReport(
      deps({
        getReport: async () => report({ lighthouse: STORED }),
        getSite: async () => LIVE_SITE,
        storeScores: async () => (wrote = true),
        loadHeaderPlate: async () => null,
      }),
      "recREP",
    );
    expect(wrote).toBe(true);
    expect(r).toMatchObject({
      status: "no-header",
      scores: "refreshed",
      scoresChange: "p:93→100,bp:78→100",
    });
  });
});
