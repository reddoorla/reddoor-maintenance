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
    url: "https://airtable.example/signed/plate.jpg",
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
      }),
    ).toBe("REPORT_RERENDER report=recREP status=rendered bytes=10 header=turso evidence=reticked");
  });
});
