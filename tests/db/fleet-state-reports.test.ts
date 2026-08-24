/** Reader-equivalence instrument for the REPORTS read layer (#539 Phase 2):
 *  for the same Airtable record, the Turso read-back must deep-equal the
 *  Airtable module's mapRow — every ReportRow field pinned, same discipline as
 *  the sites instrument (fleet-state.test.ts).
 *
 *  `renderedHtmlAttachment` is the one deliberate exception: the Airtable row
 *  links an EXPIRING signed URL; the Turso row carries the body itself and
 *  links the dashboard's own /api/reports/:id/preview route — asserted
 *  separately, present exactly when a body is stored.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import { listAllReports, listReportsForSite, getReportHtml } from "../../src/db/fleet-state.js";
import { mapRow as mapReportAirtable } from "../../src/reports/airtable/reports.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const SITE: RawRecord = { id: "recSITE", fields: { Name: "Acme Gallery" } };

const RICH: RawRecord = {
  id: "recRPT1",
  fields: {
    Site: ["recSITE"],
    "Report ID": "ACME-2026-08-M",
    "Report type": "Maintenance",
    Period: "2026-08",
    "Period start": "2026-08-01",
    "Period end": "2026-08-31",
    "Completed on": "2026-08-20",
    "Lighthouse — Performance": 98,
    "Lighthouse — Accessibility": 100,
    "Lighthouse — Best Practices": 96,
    "Lighthouse — SEO": 92,
    "GA users (period)": 120,
    "GA users (prev period)": 90,
    "Search found page 1": true,
    "Search position": 3,
    "Last tested date": "2026-08-19",
    Commentary: "Strong month.",
    "Subject override": "Your August report",
    "Draft ready": true,
    "Approved to send": false,
    "Sent at": "2026-08-21T09:00:00.000Z",
    "Approved At": "2026-08-21T08:00:00.000Z",
    "Approved By": "op",
    "Delivery status": "delivered",
    "Resend message ID": "re_abc",
    "Maint: Deploy & Function Health": true,
    "Maint: CMS Checked": true,
    "Test: Verified After Updates": false,
    // Long-text cell — the API returns a STRING of JSON (the importer must
    // store it verbatim, not double-encode it).
    "Checklist auto-evidence": JSON.stringify({
      deploy: { result: "pass", checkedAt: "2026-08-20T00:00:00.000Z", note: "ready" },
    }),
    "Send override": true,
    "Override reason": "client asked",
    "Override by": "op",
    "Override at": "2026-08-21T08:30:00.000Z",
    "Rendered HTML": [{ url: "https://airtable.example/signed/r1", filename: "r1.html" }],
  },
};

const SPARSE: RawRecord = { id: "recRPT2", fields: {} };

const WEIRD: RawRecord = {
  id: "recRPT3",
  fields: {
    Site: ["recSITE"],
    "Report type": "Newsletter", // unknown single-select → Maintenance + warn on BOTH sides
    "Lighthouse — Performance": 98,
    "Lighthouse — Accessibility": 100,
    "Lighthouse — Best Practices": 96, // SEO missing → lighthouse null on both sides
    "Checklist auto-evidence": "{not json", // malformed → null on both sides
    "Search found page 1": false, // false must survive as false, not null
  },
};

const io = (reports: RawRecord[], over: Partial<ImportIo> = {}): ImportIo => ({
  listWebsiteRecords: async () => [SITE],
  listReportRecords: async () => reports,
  fetchAttachment: async () => "<html>rendered body</html>",
  now: () => NOW,
  ...over,
});

async function importOf(reports: RawRecord[], over: Partial<ImportIo> = {}) {
  const db = await openDb({ url: ":memory:" });
  await importFleetState(db, io(reports, over));
  return db;
}

async function expectEquivalent(rec: RawRecord) {
  const db = await importOf([rec]);
  const rows = await listAllReports(db);
  expect(rows).toHaveLength(1);
  const expected = mapReportAirtable(rec);
  const { renderedHtmlAttachment: _e, ...expectedRest } = expected;
  const { renderedHtmlAttachment: gotAttachment, ...gotRest } = rows[0]!;
  expect(gotRest).toEqual(expectedRest);
  return gotAttachment;
}

describe("reports read layer ≡ mapRow (the Phase 2 equivalence instrument)", () => {
  it("rich record: every populated field round-trips, incl. the string auto-evidence cell", async () => {
    const attachment = await expectEquivalent(RICH);
    // Body stored → the link is the dashboard's OWN preview route, not an
    // expiring Airtable URL.
    expect(attachment).toEqual({
      url: "/api/reports/recRPT1/preview",
      filename: "ACME-2026-08-M.html",
    });
  });

  it("sparse record: every default matches (empty ids, Maintenance type, pending delivery, all-false checklist)", async () => {
    const attachment = await expectEquivalent(SPARSE);
    expect(attachment).toBeNull(); // no attachment in Airtable → no body stored
  });

  it("weird record: coercion edges match (unknown type, 3-of-4 lighthouse, bad evidence JSON, false-not-null)", async () => {
    await expectEquivalent(WEIRD);
  });

  it("listReportsForSite filters by site and matches the same rows", async () => {
    const db = await importOf([RICH, WEIRD]);
    const forSite = await listReportsForSite(db, "recSITE");
    expect(forSite.map((r) => r.id).sort()).toEqual(["recRPT1", "recRPT3"]);
    expect(await listReportsForSite(db, "recNOPE")).toEqual([]);
  });

  it("getReportHtml serves the stored body, null when none or unknown id", async () => {
    const db = await importOf([RICH]);
    expect(await getReportHtml(db, "recRPT1")).toEqual({
      html: "<html>rendered body</html>",
      reportId: "ACME-2026-08-M",
    });
    expect(await getReportHtml(db, "recNOPE")).toBeNull();
  });

  it("a report imported while its URL was expired reads with a null preview link until the body lands", async () => {
    const db = await importOf([RICH], { fetchAttachment: async () => null });
    const [row] = await listAllReports(db);
    expect(row!.renderedHtmlAttachment).toBeNull();
    expect(await getReportHtml(db, "recRPT1")).toBeNull();
  });
});
