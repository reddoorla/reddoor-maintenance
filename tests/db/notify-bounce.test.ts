import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  getSubmissionById,
  stampNotified,
  markNotifyBouncedByMessageId,
  countNotifyBouncedBySite,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

let db: Db;

/** Create a lead and stamp it "sent" with a Resend message id, as ingest does. */
async function sentLead(siteId: string, messageId: string, submittedAt: string): Promise<string> {
  const row = await createSubmission(db, {
    siteId,
    formType: "contact",
    name: "Lead",
    email: "lead@x.com",
    submittedAt: new Date(submittedAt),
  });
  await stampNotified(db, row.id, "sent", messageId);
  return row.id;
}

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

describe("markNotifyBouncedByMessageId", () => {
  it("flips the matching submission to 'bounced' and reports the match", async () => {
    const id = await sentLead("recA", "msg_bounce_1", "2026-07-10T00:00:00.000Z");
    expect(await markNotifyBouncedByMessageId(db, "msg_bounce_1")).toBe(true);
    expect((await getSubmissionById(db, id))!.notifyStatus).toBe("bounced");
  });

  it("returns false for an unknown message id (a report email) and touches nothing", async () => {
    const id = await sentLead("recA", "msg_ok", "2026-07-10T00:00:00.000Z");
    expect(await markNotifyBouncedByMessageId(db, "msg_report_xyz")).toBe(false);
    expect((await getSubmissionById(db, id))!.notifyStatus).toBe("sent");
  });

  it("is idempotent: a svix replay re-matches and the row stays 'bounced'", async () => {
    const id = await sentLead("recA", "msg_replay", "2026-07-10T00:00:00.000Z");
    expect(await markNotifyBouncedByMessageId(db, "msg_replay")).toBe(true);
    expect(await markNotifyBouncedByMessageId(db, "msg_replay")).toBe(true);
    expect((await getSubmissionById(db, id))!.notifyStatus).toBe("bounced");
  });

  it("never matches on an empty message id (failed/skipped rows carry no id)", async () => {
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Unsent",
      email: "u@x.com",
      submittedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(await markNotifyBouncedByMessageId(db, "")).toBe(false);
  });

  it("only flips the row whose message id matches, not the site's other leads", async () => {
    const hit = await sentLead("recA", "msg_hit", "2026-07-10T00:00:00.000Z");
    const miss = await sentLead("recA", "msg_miss", "2026-07-10T01:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "msg_hit");
    expect((await getSubmissionById(db, hit))!.notifyStatus).toBe("bounced");
    expect((await getSubmissionById(db, miss))!.notifyStatus).toBe("sent");
  });
});

describe("countNotifyBouncedBySite", () => {
  it("counts bounced rows per site on/after the window start; sent/failed rows never count", async () => {
    // recA: two bounced in-window + one still-sent; recB: one bounced in-window.
    await sentLead("recA", "msg_a1", "2026-07-10T00:00:00.000Z");
    await sentLead("recA", "msg_a2", "2026-07-12T00:00:00.000Z");
    await sentLead("recA", "msg_a3", "2026-07-13T00:00:00.000Z");
    await sentLead("recB", "msg_b1", "2026-07-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "msg_a1");
    await markNotifyBouncedByMessageId(db, "msg_a2");
    await markNotifyBouncedByMessageId(db, "msg_b1");
    const counts = await countNotifyBouncedBySite(db, "2026-07-02");
    expect(counts.get("recA")).toBe(2);
    expect(counts.get("recB")).toBe(1);
  });

  it("excludes bounced rows submitted before the window start", async () => {
    await sentLead("recA", "msg_old", "2026-06-01T00:00:00.000Z");
    await sentLead("recA", "msg_new", "2026-07-10T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "msg_old");
    await markNotifyBouncedByMessageId(db, "msg_new");
    const counts = await countNotifyBouncedBySite(db, "2026-07-02");
    expect(counts.get("recA")).toBe(1);
  });

  it("returns an empty map when nothing bounced", async () => {
    await sentLead("recA", "msg_fine", "2026-07-10T00:00:00.000Z");
    expect((await countNotifyBouncedBySite(db, "2026-07-02")).size).toBe(0);
  });
});
