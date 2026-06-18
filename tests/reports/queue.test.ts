import { describe, it, expect } from "vitest";
import { reportTier, queueDraft } from "../../src/reports/queue.js";
import { makeFakeBase, type FakeRecord } from "./_helpers/fake-airtable-base.js";
import type { ReportType } from "../../src/reports/types.js";

/** A Reports row, pending-approval (Draft ready) by default. */
function rep(
  id: string,
  siteId: string,
  type: ReportType,
  over: Record<string, unknown> = {},
): FakeRecord {
  return {
    id,
    fields: { "Report ID": id, Site: [siteId], "Report type": type, "Draft ready": true, ...over },
  };
}

/** Did the run set `Draft ready` to `ready` on row `id`? */
function setReadyCalled(
  base: ReturnType<typeof makeFakeBase>,
  id: string,
  ready: boolean,
): boolean {
  return base.__calls.some(
    (c) =>
      c.kind === "update" &&
      c.records[0]?.id === id &&
      c.records[0]?.fields["Draft ready"] === ready,
  );
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
    const base = makeFakeBase({
      Reports: [rep("new", "siteA", "Maintenance", { "Draft ready": false })],
    });
    const out = await queueDraft(base, { id: "new", siteId: "siteA", reportType: "Maintenance" });
    expect(out).toEqual({ queued: true, supersededIds: [] });
    expect(setReadyCalled(base, "new", true)).toBe(true);
  });

  it("supersedes lower-tier pending reports (un-queues them) and queues the higher one", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("maint", "siteA", "Maintenance"), // pending, lower tier
        rep("test", "siteA", "Testing", { "Draft ready": false }), // the new draft
      ],
    });
    const out = await queueDraft(base, { id: "test", siteId: "siteA", reportType: "Testing" });
    expect(out).toEqual({ queued: true, supersededIds: ["maint"] });
    expect(setReadyCalled(base, "maint", false)).toBe(true); // superseded
    expect(setReadyCalled(base, "test", true)).toBe(true); // queued
  });

  it("stands down when an equal-or-higher tier is already queued (and leaves it alone)", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("test", "siteA", "Testing"), // pending, higher tier
        rep("maint", "siteA", "Maintenance", { "Draft ready": false }), // the new draft
      ],
    });
    const out = await queueDraft(base, { id: "maint", siteId: "siteA", reportType: "Maintenance" });
    expect(out).toEqual({ queued: false, blockedBy: "Testing", supersededIds: [] });
    expect(setReadyCalled(base, "maint", false)).toBe(true); // new one forced not-ready
    expect(base.__calls.some((c) => c.kind === "update" && c.records[0]?.id === "test")).toBe(
      false,
    );
  });

  it("equal tier blocks — a queued Launch stops a new Announcement", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("launch", "siteA", "Launch"),
        rep("ann", "siteA", "Announcement", { "Draft ready": false }),
      ],
    });
    const out = await queueDraft(base, { id: "ann", siteId: "siteA", reportType: "Announcement" });
    expect(out).toEqual({ queued: false, blockedBy: "Launch", supersededIds: [] });
  });

  it("ignores pending reports for OTHER sites", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("otherTest", "siteB", "Testing"), // higher tier, different site
        rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
      ],
    });
    const out = await queueDraft(base, { id: "maint", siteId: "siteA", reportType: "Maintenance" });
    expect(out.queued).toBe(true);
  });

  it("ignores already-sent reports (they're out of the queue)", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("sentTest", "siteA", "Testing", { "Sent at": "2026-06-01T00:00:00.000Z" }), // sent
        rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
      ],
    });
    const out = await queueDraft(base, { id: "maint", siteId: "siteA", reportType: "Maintenance" });
    expect(out.queued).toBe(true); // a SENT Testing does not block
  });

  it("ignores approved-but-not-yet-sent reports (past the queue)", async () => {
    const base = makeFakeBase({
      Reports: [
        rep("approvedTest", "siteA", "Testing", { "Approved to send": true }), // approved, not sent
        rep("maint", "siteA", "Maintenance", { "Draft ready": false }),
      ],
    });
    const out = await queueDraft(base, { id: "maint", siteId: "siteA", reportType: "Maintenance" });
    expect(out.queued).toBe(true); // an approved Testing is past the approve queue → does not block
  });

  it("excludes the report's own row — a draft already Draft-ready (reuse path) doesn't block itself", async () => {
    // The reuse/complete path can hand queueDraft a row that a prior run left Draft-ready. It must
    // not see ITSELF as an equal-tier blocker; the own-id filter keeps it queued.
    const base = makeFakeBase({ Reports: [rep("self", "siteA", "Testing")] }); // already Draft ready
    const out = await queueDraft(base, { id: "self", siteId: "siteA", reportType: "Testing" });
    expect(out).toEqual({ queued: true, supersededIds: [] });
  });
});
