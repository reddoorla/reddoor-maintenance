/** MED-11 (2026-09-02): `/s/:slug` ran three fleet-wide aggregates per load and
 *  threw away every row but one site's. The per-site replacements have to give
 *  the SAME answer for that site — a faster query that quietly reports something
 *  else is worse than the slow one it replaced.
 *
 *  So every case here is an equivalence, asserted against a fixture with more
 *  than one site and rows outside the window. The other-site rows are what make
 *  it a real test: a per-site query that forgot its `site_id` predicate would
 *  match the fleet-wide total and pass a single-site fixture.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  createSubmission,
  stampNotified,
  markNotifyBouncedByMessageId,
  setSubmissionStatusRow,
  countNotifyBouncedBySite,
  countNotifyBouncedForSite,
} from "../../src/db/submissions.js";
import {
  recordScreenOut,
  listScreenOutsSince,
  screenOutTotalsForSite,
} from "../../src/db/screenouts.js";
import {
  createDeadLetter,
  countUnreplayedDeadLettersBySlug,
  countUnreplayedDeadLettersForSlug,
  listUnreplayedDeadLetters,
  markDeadLetterReplayed,
} from "../../src/db/deadletter.js";

let db: Db;
const SINCE = "2026-08-01";
const SINCE_ISO = "2026-08-01T00:00:00.000Z";

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

async function bouncedLead(siteId: string, messageId: string, at: string): Promise<void> {
  const row = await createSubmission(db, {
    siteId,
    formType: "contact",
    name: "Lead",
    email: "lead@x.com",
    submittedAt: new Date(at),
  });
  await stampNotified(db, row.id, "sent", messageId);
  await markNotifyBouncedByMessageId(db, messageId);
}

describe("countNotifyBouncedForSite matches the fleet-wide map, for that site", () => {
  beforeEach(async () => {
    await bouncedLead("recA", "m_a1", "2026-08-10T00:00:00.000Z");
    await bouncedLead("recA", "m_a2", "2026-08-11T00:00:00.000Z");
    await bouncedLead("recB", "m_b1", "2026-08-12T00:00:00.000Z");
    // Outside the window — must be counted by neither.
    await bouncedLead("recA", "m_old", "2026-07-01T00:00:00.000Z");
  });

  it("agrees with the map entry for a site that has bounces", async () => {
    const map = await countNotifyBouncedBySite(db, SINCE);
    expect(await countNotifyBouncedForSite(db, "recA", SINCE)).toEqual(map.get("recA"));
    expect(await countNotifyBouncedForSite(db, "recA", SINCE)).toEqual({ total: 2, permanent: 0 });
  });

  it("does not inherit another site's bounces", async () => {
    // The assertion the site_id predicate exists for: recB has one, recA two,
    // and a forgotten predicate would report three for both.
    expect(await countNotifyBouncedForSite(db, "recB", SINCE)).toEqual({
      total: 1,
      permanent: 0,
    });
  });

  it("reports zeroes for a site absent from the map (positive control)", async () => {
    const map = await countNotifyBouncedBySite(db, SINCE);
    expect(map.has("recQuiet")).toBe(false);
    expect(await countNotifyBouncedForSite(db, "recQuiet", SINCE)).toEqual({
      total: 0,
      permanent: 0,
    });
  });
});

describe("screenOutTotalsForSite matches the fleet-wide map, for that site", () => {
  beforeEach(async () => {
    await recordScreenOut(db, "recA", "honeypot", "2026-08-10");
    await recordScreenOut(db, "recA", "honeypot", "2026-08-11");
    await recordScreenOut(db, "recA", "too-fast", "2026-08-11");
    await recordScreenOut(db, "recB", "honeypot", "2026-08-11");
    // Before the window.
    await recordScreenOut(db, "recA", "honeypot", "2026-07-02");

    const spam = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Bot",
      email: "bot@x.com",
      submittedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    await setSubmissionStatusRow(db, spam.id, "spam");
    const otherSpam = await createSubmission(db, {
      siteId: "recB",
      formType: "contact",
      name: "Bot",
      email: "bot@x.com",
      submittedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    await setSubmissionStatusRow(db, otherSpam.id, "spam");
  });

  it("agrees with the map entry, across both of its sources", async () => {
    const map = await listScreenOutsSince(db, SINCE);
    expect(await screenOutTotalsForSite(db, "recA", SINCE)).toEqual(map.get("recA"));
    expect(await screenOutTotalsForSite(db, "recA", SINCE)).toEqual({
      honeypot: 2,
      tooFast: 1,
      markedSpam: 1,
    });
  });

  it("does not inherit another site's screen-outs or spam marks", async () => {
    expect(await screenOutTotalsForSite(db, "recB", SINCE)).toEqual({
      honeypot: 1,
      tooFast: 0,
      markedSpam: 1,
    });
  });

  it("reports zeroes, not null, for a site with nothing screened (positive control)", async () => {
    // `null` is the handler's way of saying the READ failed; a quiet site must
    // never be rendered as an outage.
    expect(await screenOutTotalsForSite(db, "recQuiet", SINCE)).toEqual({
      honeypot: 0,
      tooFast: 0,
      markedSpam: 0,
    });
  });
});

describe("countUnreplayedDeadLettersForSlug matches the fleet-wide map, for that slug", () => {
  beforeEach(async () => {
    for (const slug of ["acme", "acme", "other"]) {
      await createDeadLetter(db, {
        siteSlug: slug,
        payload: { name: "Ada" },
        turnstile: { outcome: "pass", hostname: `${slug}.example.com` },
        error: "site lookup failed",
        receivedAt: new Date(SINCE_ISO),
      });
    }
  });

  it("agrees with the map entry for a slug with queued rows", async () => {
    const map = await countUnreplayedDeadLettersBySlug(db);
    expect(await countUnreplayedDeadLettersForSlug(db, "acme")).toBe(map.get("acme"));
    expect(await countUnreplayedDeadLettersForSlug(db, "acme")).toBe(2);
    expect(await countUnreplayedDeadLettersForSlug(db, "other")).toBe(1);
  });

  it("drops a row once it is replayed, exactly as the grouped query does", async () => {
    const [row] = await listUnreplayedDeadLetters(db);
    await markDeadLetterReplayed(db, row!.id, "accepted", "sub_x", new Date());
    const map = await countUnreplayedDeadLettersBySlug(db);
    expect(await countUnreplayedDeadLettersForSlug(db, row!.siteSlug)).toBe(
      map.get(row!.siteSlug) ?? 0,
    );
  });

  it("reports 0 for a slug with no queued rows (positive control)", async () => {
    const map = await countUnreplayedDeadLettersBySlug(db);
    expect(map.has("quiet")).toBe(false);
    expect(await countUnreplayedDeadLettersForSlug(db, "quiet")).toBe(0);
  });
});
