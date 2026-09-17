/**
 * #646 step 4 (operator decision 2026-09-17): new reports get `report_<ULID>`
 * ids minted by Turso, and Airtable can never hold a record under one. Every
 * Airtable writer that takes a REPORT id must therefore skip a non-`rec` id on
 * purpose — with the same stable greppable line the site writers log — instead of
 * 404ing on a row Airtable has never heard of. The paths that reach these
 * writers are the drafting queue flag, the approve/override stamps, the delivery
 * webhook and the nightly send's `Sent at`.
 *
 * Two closures keep this honest, the same pair the site version uses:
 *   1. Completeness — every exported writer in `airtable/reports.ts` that
 *      addresses a Reports row by id must appear in WRITERS. A new one fails the
 *      build until someone decides how it treats a `report_` id.
 *   2. The positive control — each writer, given a `rec` id, still writes. A
 *      guard that skipped everything would satisfy the skip assertions alone.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as reports from "../../../src/reports/airtable/reports.js";
import { makeFakeBase, type FakeAirtableBase } from "../_helpers/fake-airtable-base.js";

const REPORT_ID = "report_01ARYZ6S41TSV4RRFFQ69G5FAV";
const REC_ID = "recREPORT1";

type Writer = {
  name: string;
  call: (base: FakeAirtableBase, id: string) => Promise<unknown>;
};

const WRITERS: Writer[] = [
  { name: "setDraftReady", call: (b, id) => reports.setDraftReady(b, id, true) },
  {
    name: "updateReportScores",
    call: (b, id) =>
      reports.updateReportScores(b, id, {
        performance: 1,
        accessibility: 1,
        bestPractices: 1,
        seo: 1,
      }),
  },
  {
    name: "updateReportCommentary",
    call: (b, id) => reports.updateReportCommentary(b, id, "looks good"),
  },
  {
    name: "stampSent",
    call: (b, id) => reports.stampSent(b, id, new Date("2026-09-17T00:00:00.000Z"), "msg_1"),
  },
  { name: "setDeliveryStatus", call: (b, id) => reports.setDeliveryStatus(b, id, "delivered") },
  {
    name: "approveReportRow",
    call: (b, id) => reports.approveReportRow(b, id, new Date("2026-09-17"), "operator"),
  },
  {
    name: "overrideReportRow",
    call: (b, id) => reports.overrideReportRow(b, id, new Date("2026-09-17"), "operator", "why"),
  },
];

/** Exported functions of the module that WRITE to a Reports row by record id.
 *  Derived from the source rather than listed, so a new writer cannot be added
 *  without either being covered here or being named in this exemption list. */
const NOT_ROW_WRITERS = new Set([
  // reads / pure helpers / the legacy creator (covered by its own test: it
  // refuses a site_ id by name rather than skipping, because it MINTS the id)
  "createDraft",
  "listSendableReports",
  "listAllReports",
  "listReportsForSite",
  "getReportById",
  "findReportByMessageId",
  "findReportByPeriod",
  "mapRow",
  "escapeFormulaString",
  "draftFields",
  "ymd",
  "toReportType",
  "isPendingApproval",
  "parseAutoEvidence",
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Airtable report writers skip a Turso-minted report_ id (#646 step 4)", () => {
  it("covers every exported by-id Reports writer (completeness)", () => {
    const exported = Object.entries(reports)
      .filter(([name, v]) => typeof v === "function" && !NOT_ROW_WRITERS.has(name))
      .map(([name]) => name)
      .sort();
    expect(WRITERS.map((w) => w.name).sort()).toEqual(exported);
  });

  for (const w of WRITERS) {
    it(`${w.name}: skips a report_ id, logs AIRTABLE_SHADOW skipped=non-rec-id, never reaches Airtable`, async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const base = makeFakeBase({ Reports: [] });
      await w.call(base, REPORT_ID);
      expect(base.__calls).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        `AIRTABLE_SHADOW skipped=non-rec-id writer=${w.name} id=${REPORT_ID}`,
      );
    });

    it(`${w.name}: still writes a rec id (positive control)`, async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const base = makeFakeBase({ Reports: [{ id: REC_ID, fields: { "Report ID": "acme" } }] });
      await w.call(base, REC_ID);
      expect(base.__calls.some((c) => c.kind === "update" && c.records[0]?.id === REC_ID)).toBe(
        true,
      );
      expect(log.mock.calls.flat().join("\n")).not.toContain("AIRTABLE_SHADOW skipped=non-rec-id");
    });
  }
});
