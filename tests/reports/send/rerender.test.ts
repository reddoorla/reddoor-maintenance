import { describe, it, expect } from "vitest";
import { rerenderReport, type RerenderDeps } from "../../../src/reports/send/rerender.js";
import { makeWebsiteRow } from "../../_helpers/website-row.js";
import type { ReportRow } from "../../../src/reports/airtable/reports.js";

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

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "ACME-M",
    siteId: "recSITE",
    sentAt: null,
    ...over,
  } as ReportRow;
}

function deps(over: Partial<RerenderDeps> = {}): RerenderDeps {
  return {
    getReport: async () => report(),
    getSite: async () => SITE,
    loadHeaderPlate: async () => new Uint8Array([9, 9, 9]),
    fetchAirtableHeader: async () => new Uint8Array([1, 1, 1]),
    render: async () => ({ html: "<html>rendered</html>" }),
    store: async () => {},
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

  it("prefers the header plate stored in Turso over an Airtable fetch", async () => {
    // D5: the bytes are already local, and the Airtable URL is signed and
    // expiring. Fetching it when we have the same image is pure latency plus a
    // dependency on a URL that may already be dead.
    let fetched = false;
    const seen: Uint8Array[] = [];
    const r = await rerenderReport(
      deps({
        fetchAirtableHeader: async () => {
          fetched = true;
          return new Uint8Array([1, 1, 1]);
        },
        render: async (_s, _r, plate) => {
          seen.push(plate);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r.status).toBe("rendered");
    expect(fetched).toBe(false);
    expect(seen[0]).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("falls back to the Airtable attachment when Turso has no plate", async () => {
    const seen: Uint8Array[] = [];
    const r = await rerenderReport(
      deps({
        loadHeaderPlate: async () => null,
        render: async (_s, _r, plate) => {
          seen.push(plate);
          return { html: "x" };
        },
      }),
      "recREP",
    );
    expect(r.status).toBe("rendered");
    expect(seen[0]).toEqual(new Uint8Array([1, 1, 1]));
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
