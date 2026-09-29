import { describe, it, expect } from "vitest";
import { reportTier, queueDraft } from "../../src/reports/queue.js";
import { makeFakeReportWriter } from "./_helpers/fake-report-writer.js";
import { reportRowsFrom, type RawRow } from "../_helpers/raw-rows.js";
import type { ReportType } from "../../src/reports/types.js";

/** A Reports row, pending-approval (Draft ready) by default. */
function rep(
  id: string,
  siteId: string,
  type: ReportType,
  over: Record<string, unknown> = {},
): RawRow {
  return {
    id,
    fields: { "Report ID": id, Site: [siteId], "Report type": type, "Draft ready": true, ...over },
  };
}

/** The site's reports, as Turso holds them — the store `queueDraft` reads
 *  since #646 step 4. */
function stores(records: RawRow[]) {
  return { writer: makeFakeReportWriter(reportRowsFrom(records)) };
}

/** Did the run set `Draft ready` to `ready` on row `id`? Asked of TURSO (#646
 *  step 4): that is the store of record. */
function setReadyCalled(
  writer: ReturnType<typeof makeFakeReportWriter>,
  id: string,
  ready: boolean,
): boolean {
  return writer.patches.some((p) => p.id === id && p.patch.draft_ready === (ready ? 1 : 0));
}

describe("reportTier", () => {
  it("orders Maintenance < Testing < Announcement = Launch", () => {
    expect(reportTier("Maintenance")).toBeLessThan(reportTier("Testing"));
    expect(reportTier("Testing")).toBeLessThan(reportTier("Announcement"));
    expect(reportTier("Announcement")).toBe(reportTier("Launch"));
  });
});

describe("queueDraft", () => {
  it("queues a draft when nothing else is pending for the site", async () => {
    const { writer } = stores([rep("rec_new", "siteA", "Maintenance", { "Draft ready": false })]);
    const out = await queueDraft(
      { id: "rec_new", siteId: "siteA", reportType: "Maintenance" },
      writer,
    );
    expect(out).toEqual({ queued: true, supersededIds: [] });
    expect(setReadyCalled(writer, "rec_new", true)).toBe(true);
  });

  it("supersedes lower-tier pending reports (un-queues them) and queues the higher one", async () => {
    const { writer } = stores([
      rep("maint", "siteA", "Maintenance"), // pending, lower tier
      rep("test", "siteA", "Testing", { "Draft ready": false }), // the new draft
    ]);
    const out = await queueDraft({ id: "test", siteId: "siteA", reportType: "Testing" }, writer);
    expect(out).toEqual({ queued: true, supersededIds: ["maint"] });
    expect(setReadyCalled(writer, "maint", false)).toBe(true); // superseded
    expect(setReadyCalled(writer, "test", true)).toBe(true); // queued
  });

  it("stands down when an equal-or-higher tier is already queued (and leaves it alone)", async () => {
    const { writer } = stores([
      rep("test", "siteA", "Testing"), // pending, higher tier
      rep("maint", "siteA", "Maintenance", { "Draft ready": false }), // the new draft
    ]);
    const out = await queueDraft(
      { id: "maint", siteId: "siteA", reportType: "Maintenance" },
      writer,
    );
    expect(out).toEqual({ queued: false, blockedBy: "Testing", supersededIds: [] });
    expect(setReadyCalled(writer, "maint", false)).toBe(true); // new one forced not-ready
    expect(writer.patches.some((p) => p.id === "test")).toBe(false);
  });

  it("equal tier blocks — a queued Launch stops a new Announcement", async () => {
    const { writer } = stores([
      rep("launch", "siteA", "Launch"),
      rep("ann", "siteA", "Announcement", { "Draft ready": false }),
    ]);
    const out = await queueDraft(
      { id: "ann", siteId: "siteA", reportType: "Announcement" },
      writer,
    );
    expect(out).toEqual({ queued: false, blockedBy: "Launch", supersededIds: [] });
  });

  it("ignores pending reports for OTHER sites", async () => {
    const { writer } = stores([
      rep("otherTest", "siteB", "Testing"), // higher tier, different site
      rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
    ]);
    const out = await queueDraft(
      { id: "maint", siteId: "siteA", reportType: "Maintenance" },
      writer,
    );
    expect(out.queued).toBe(true);
  });

  it("ignores already-sent reports (they're out of the queue)", async () => {
    const { writer } = stores([
      rep("sentTest", "siteA", "Testing", { "Sent at": "2026-06-01T00:00:00.000Z" }), // sent
      rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
    ]);
    const out = await queueDraft(
      { id: "maint", siteId: "siteA", reportType: "Maintenance" },
      writer,
    );
    expect(out.queued).toBe(true); // a SENT Testing does not block
  });

  it("ignores approved-but-not-yet-sent reports (past the queue)", async () => {
    const { writer } = stores([
      rep("approvedTest", "siteA", "Testing", { "Approved to send": true }), // approved, not sent
      rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
    ]);
    const out = await queueDraft(
      { id: "maint", siteId: "siteA", reportType: "Maintenance" },
      writer,
    );
    expect(out.queued).toBe(true); // an approved Testing is past the approve queue → does not block
  });

  it("excludes the report's own row — a draft already Draft-ready (reuse path) doesn't block itself", async () => {
    // The reuse/complete path can hand queueDraft a row that a prior run left Draft-ready. It must
    // not see ITSELF as an equal-tier blocker; the own-id filter keeps it queued.
    const { writer } = stores([rep("self", "siteA", "Testing")]);
    const out = await queueDraft({ id: "self", siteId: "siteA", reportType: "Testing" }, writer);
    expect(out).toEqual({ queued: true, supersededIds: [] });
  });
});

/**
 * #539 Phase 5. The mirror has to follow EVERY flag this function writes, not
 * just the new draft's: un-queueing the superseded rows is the whole point of
 * `queueDraft`, so a mirror covering only `report.id` would leave the console
 * showing a site with two queued reports.
 */
describe("queueDraft → the Turso mirror", () => {
  it("mirrors the superseded row's flag as well as the queued one", async () => {
    const { writer } = stores([
      rep("maint", "siteA", "Maintenance"),
      rep("test", "siteA", "Testing", { "Draft ready": false }),
    ]);
    await queueDraft({ id: "test", siteId: "siteA", reportType: "Testing" }, writer);

    expect(writer.patches).toEqual([
      { id: "maint", patch: { draft_ready: 0 } },
      { id: "test", patch: { draft_ready: 1 } },
    ]);
  });

  it("mirrors the stand-down too, so a blocked draft is not left queued in Turso", async () => {
    const { writer } = stores([
      rep("test", "siteA", "Testing"),
      rep("maint", "siteA", "Maintenance", { "Draft ready": true }),
    ]);
    await queueDraft({ id: "maint", siteId: "siteA", reportType: "Maintenance" }, writer);

    expect(writer.patches).toEqual([{ id: "maint", patch: { draft_ready: 0 } }]);
  });

  it("queues a minted `report_<ULID>` id in Turso", async () => {
    const id = "report_01ARYZ6S41TSV4RRFFQ69G5FAV";
    const { writer } = stores([rep(id, "siteA", "Maintenance", { "Draft ready": false })]);
    const out = await queueDraft({ id, siteId: "siteA", reportType: "Maintenance" }, writer);
    expect(out).toEqual({ queued: true, supersededIds: [] });
    expect(writer.patches).toEqual([{ id, patch: { draft_ready: 1 } }]);
  });
});
