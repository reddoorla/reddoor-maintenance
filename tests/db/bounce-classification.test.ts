import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  getSubmissionById,
  stampNotified,
  markNotifyBouncedByMessageId,
  countNotifyBouncedBySite,
  ackNotifyBounce,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

/**
 * #783. A client-side spam rejection and a dead mailbox were the SAME stored
 * state: the webhook dropped Resend's `bounce` object, so `notify_status =
 * 'bounced'` was all that survived, and the alarm told the operator to "check
 * the point-of-contact address" for an address that was fine.
 *
 * Espada, 2026-09-11: their inbound filter refused two lead notifications whose
 * spam_score (30 and 55) sat under our auto-filter line. Nothing could clear the
 * alarm but fourteen days of aging, so it was cleared by a hand-written UPDATE
 * against production — which is the thing this tracker exists to make
 * unnecessary.
 */

let db: Db;

/** A lead stamped "sent" with a Resend message id, exactly as ingest leaves it. */
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

/** The classification Resend sends for a dead mailbox. */
const PERMANENT = {
  type: "Permanent",
  subType: "Suppressed",
  message: "The recipient's email address is on the suppression list.",
};

/** The Espada shape: the receiving server refused the CONTENT, not the address. */
const TRANSIENT = {
  type: "Transient",
  subType: "ContentRejected",
  message: "552 5.7.1 Message rejected as spam by Content Filtering",
};

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

describe("bounce classification is stored, not discarded", () => {
  it("keeps the type, sub-type and the receiving server's message on the row", async () => {
    const id = await sentLead("recA", "msg_1", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "msg_1", TRANSIENT);
    const row = (await getSubmissionById(db, id))!;
    expect(row.notifyStatus).toBe("bounced");
    expect(row.bounceType).toBe("Transient");
    expect(row.bounceSubType).toBe("ContentRejected");
    expect(row.bounceMessage).toBe("552 5.7.1 Message rejected as spam by Content Filtering");
  });

  it("leaves the detail null for a complaint, which carries no bounce object", async () => {
    // Verified against Resend's own payload docs: `email.complained` has no
    // `data.bounce`. Inventing one would fabricate a diagnosis.
    const id = await sentLead("recA", "msg_2", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "msg_2", null);
    const row = (await getSubmissionById(db, id))!;
    expect(row.notifyStatus).toBe("bounced");
    expect(row.bounceType).toBeNull();
    expect(row.bounceSubType).toBeNull();
    expect(row.bounceMessage).toBeNull();
  });

  it("still reports the match when the row is already bounced (svix replay)", async () => {
    await sentLead("recA", "msg_3", "2026-09-11T00:00:00.000Z");
    expect(await markNotifyBouncedByMessageId(db, "msg_3", PERMANENT)).toBe(true);
    expect(await markNotifyBouncedByMessageId(db, "msg_3", PERMANENT)).toBe(true);
  });

  it("returns false for an unknown message id and writes no detail anywhere", async () => {
    const id = await sentLead("recA", "msg_ok", "2026-09-11T00:00:00.000Z");
    expect(await markNotifyBouncedByMessageId(db, "msg_report_xyz", PERMANENT)).toBe(false);
    const row = (await getSubmissionById(db, id))!;
    expect(row.notifyStatus).toBe("sent");
    expect(row.bounceType).toBeNull();
  });
});

describe("countNotifyBouncedBySite splits permanent from the rest", () => {
  it("reports the total AND how many were permanent", async () => {
    await sentLead("recA", "a1", "2026-09-11T00:00:00.000Z");
    await sentLead("recA", "a2", "2026-09-12T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "a1", PERMANENT);
    await markNotifyBouncedByMessageId(db, "a2", TRANSIENT);
    const counts = await countNotifyBouncedBySite(db, "2026-09-01");
    expect(counts.get("recA")).toEqual({ total: 2, permanent: 1 });
  });

  it("counts an unclassified bounce toward the total but never toward permanent", async () => {
    // Every row written before this migration has a null type. Reading null as
    // "permanent" would keep telling the operator the address is dead on exactly
    // the rows that caused #783; reading it as permanent=0 keeps the old
    // wording only where the payload actually says so.
    await sentLead("recA", "u1", "2026-09-11T00:00:00.000Z");
    await sentLead("recA", "u2", "2026-09-12T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "u1", null);
    await markNotifyBouncedByMessageId(db, "u2", null);
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).get("recA")).toEqual({
      total: 2,
      permanent: 0,
    });
  });

  it("still excludes rows submitted before the window start", async () => {
    await sentLead("recA", "old", "2026-08-01T00:00:00.000Z");
    await sentLead("recA", "new", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "old", PERMANENT);
    await markNotifyBouncedByMessageId(db, "new", PERMANENT);
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).get("recA")).toEqual({
      total: 1,
      permanent: 1,
    });
  });

  it("returns an empty map when nothing bounced", async () => {
    await sentLead("recA", "fine", "2026-09-11T00:00:00.000Z");
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).size).toBe(0);
  });
});

describe("ackNotifyBounce — the operator's exit, meaning 'not dead'", () => {
  it("drops an acked row from the count without destroying the bounce record", async () => {
    // The hand-run production workaround flipped `bounced` back to `sent`, which
    // erased the evidence. An ack has to clear the alarm and KEEP the row.
    const id = await sentLead("recA", "e1", "2026-09-11T00:00:00.000Z");
    await sentLead("recA", "e2", "2026-09-12T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "e1", TRANSIENT);
    await markNotifyBouncedByMessageId(db, "e2", TRANSIENT);
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).get("recA")!.total).toBe(2);

    expect(await ackNotifyBounce(db, id, new Date("2026-09-14T10:00:00.000Z"))).toBe(true);

    const row = (await getSubmissionById(db, id))!;
    expect(row.notifyStatus).toBe("bounced");
    expect(row.bounceMessage).toBe(TRANSIENT.message);
    expect(row.bounceAckAt).toBe("2026-09-14T10:00:00.000Z");
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).get("recA")!.total).toBe(1);
  });

  it("clears the site from the map entirely once every bounce is acked", async () => {
    const id = await sentLead("recA", "only", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "only", TRANSIENT);
    await ackNotifyBounce(db, id, new Date("2026-09-14T10:00:00.000Z"));
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).size).toBe(0);
  });

  it("is idempotent — a second ack keeps the FIRST timestamp", async () => {
    const id = await sentLead("recA", "twice", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "twice", TRANSIENT);
    await ackNotifyBounce(db, id, new Date("2026-09-14T10:00:00.000Z"));
    expect(await ackNotifyBounce(db, id, new Date("2026-09-15T10:00:00.000Z"))).toBe(false);
    expect((await getSubmissionById(db, id))!.bounceAckAt).toBe("2026-09-14T10:00:00.000Z");
  });

  // ── grant-side cases: the ack must not become a way to silence anything else ──

  it("refuses a row that did not bounce (nothing to acknowledge)", async () => {
    const id = await sentLead("recA", "healthy", "2026-09-11T00:00:00.000Z");
    expect(await ackNotifyBounce(db, id, new Date("2026-09-14T10:00:00.000Z"))).toBe(false);
    expect((await getSubmissionById(db, id))!.bounceAckAt).toBeNull();
  });

  it("refuses an unknown submission id", async () => {
    expect(await ackNotifyBounce(db, "sub_nope", new Date("2026-09-14T10:00:00.000Z"))).toBe(false);
  });

  it("acks ONLY the named row, never the site's other bounces", async () => {
    const one = await sentLead("recA", "m1", "2026-09-11T00:00:00.000Z");
    const two = await sentLead("recA", "m2", "2026-09-12T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "m1", TRANSIENT);
    await markNotifyBouncedByMessageId(db, "m2", PERMANENT);
    await ackNotifyBounce(db, one, new Date("2026-09-14T10:00:00.000Z"));
    expect((await getSubmissionById(db, two))!.bounceAckAt).toBeNull();
    expect((await countNotifyBouncedBySite(db, "2026-09-01")).get("recA")).toEqual({
      total: 1,
      permanent: 1,
    });
  });

  it("a PERMANENT bounce is still ackable — the operator may have fixed the address", async () => {
    // Deliberately not refused. The ack means "I looked at this", not "this was
    // a false alarm"; refusing it here would leave the one case the operator
    // most wants to close after fixing the mailbox.
    const id = await sentLead("recA", "perm", "2026-09-11T00:00:00.000Z");
    await markNotifyBouncedByMessageId(db, "perm", PERMANENT);
    expect(await ackNotifyBounce(db, id, new Date("2026-09-14T10:00:00.000Z"))).toBe(true);
  });
});
