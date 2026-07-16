import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  getSubmissionById,
  markFilteredAsRead,
  rescoreSubmissionSpam,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

let db: Db;

const base = {
  siteId: "recA",
  formType: "contact" as const,
  name: "X",
  email: "x@x.com",
  message: "hello there",
  submittedAt: new Date("2026-06-25T00:00:00.000Z"),
};

describe("markFilteredAsRead", () => {
  let newA: SubmissionRow; // recA, new
  let newB: SubmissionRow; // recB, new, distinctive message
  let readA: SubmissionRow; // recA, already read
  let spamA: SubmissionRow; // recA, spam_auto — must NEVER be bulk-"read"

  beforeEach(async () => {
    db = await openDb({ url: ":memory:" });
    newA = await createSubmission(db, base);
    newB = await createSubmission(db, {
      ...base,
      siteId: "recB",
      message: "please call me back about the quote",
    });
    readA = await createSubmission(db, { ...base, status: "read" });
    spamA = await createSubmission(db, {
      ...base,
      status: "spam_auto",
      spamScore: 80,
      spamReason: "keywords:2",
    });
  });

  it("flips every still-'new' row matching an empty filter and reports the count", async () => {
    const n = await markFilteredAsRead(db, {});
    expect(n).toBe(2);
    expect((await getSubmissionById(db, newA.id))?.status).toBe("read");
    expect((await getSubmissionById(db, newB.id))?.status).toBe("read");
  });

  it("never touches spam/read rows even when the filter matches them", async () => {
    await markFilteredAsRead(db, {});
    expect((await getSubmissionById(db, spamA.id))?.status).toBe("spam_auto");
    // and the read row keeps its status (idempotence aside, it was never written)
    expect((await getSubmissionById(db, readA.id))?.status).toBe("read");
  });

  it("respects the siteId filter", async () => {
    const n = await markFilteredAsRead(db, { siteId: "recA" });
    expect(n).toBe(1);
    expect((await getSubmissionById(db, newA.id))?.status).toBe("read");
    expect((await getSubmissionById(db, newB.id))?.status).toBe("new");
  });

  it("respects the search filter", async () => {
    const n = await markFilteredAsRead(db, { search: "call me back" });
    expect(n).toBe(1);
    expect((await getSubmissionById(db, newB.id))?.status).toBe("read");
    expect((await getSubmissionById(db, newA.id))?.status).toBe("new");
  });

  it("a filter explicitly targeting a non-'new' status flips nothing", async () => {
    const n = await markFilteredAsRead(db, { status: "spam_auto" });
    expect(n).toBe(0);
    expect((await getSubmissionById(db, spamA.id))?.status).toBe("spam_auto");
  });

  it("returns 0 when nothing matches", async () => {
    expect(await markFilteredAsRead(db, { siteId: "recNOPE" })).toBe(0);
  });
});

describe("rescoreSubmissionSpam", () => {
  beforeEach(async () => {
    db = await openDb({ url: ":memory:" });
  });

  it("flips a still-'new' row to spam_auto, REPLACING score and reason", async () => {
    const row = await createSubmission(db, { ...base, spamScore: 20, spamReason: "links:1" });
    const wrote = await rescoreSubmissionSpam(db, row.id, 75, "keywords:2,retro-rescore");
    expect(wrote).toBe(true);
    const after = await getSubmissionById(db, row.id);
    expect(after?.status).toBe("spam_auto");
    expect(after?.spamScore).toBe(75);
    // replaced, not appended — the new verdict supersedes the stale ingest-time one
    expect(after?.spamReason).toBe("keywords:2,retro-rescore");
  });

  it("refuses operator-touched rows (status guard) and reports false", async () => {
    const row = await createSubmission(db, {
      ...base,
      status: "read",
      spamScore: 20,
      spamReason: "links:1",
    });
    const wrote = await rescoreSubmissionSpam(db, row.id, 75, "keywords:2,retro-rescore");
    expect(wrote).toBe(false);
    const after = await getSubmissionById(db, row.id);
    expect(after?.status).toBe("read");
    expect(after?.spamScore).toBe(20);
    expect(after?.spamReason).toBe("links:1");
  });
});
