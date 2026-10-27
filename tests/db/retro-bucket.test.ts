import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  getSubmissionById,
  markSubmissionsSpamRetro,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

let db: Db;
let fresh: SubmissionRow; // status new, no spam_reason
let scored: SubmissionRow; // status new, classifier already left a reason
let read: SubmissionRow; // operator already read it — must NEVER be touched
let bystander: SubmissionRow; // status new but NOT in ids — must not be touched

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  const base = {
    siteId: "recA",
    formType: "contact" as const,
    name: "X",
    email: "x@x.com",
    message: "body",
    submittedAt: new Date("2026-06-25T00:00:00.000Z"),
  };
  fresh = await createSubmission(db, base);
  scored = await createSubmission(db, { ...base, spamScore: 20, spamReason: "links:1" });
  read = await createSubmission(db, { ...base, status: "read" });
  bystander = await createSubmission(db, base);
});

describe("markSubmissionsSpamRetro", () => {
  it("flips status='new' rows in ids to spam_auto and stamps the retro reason", async () => {
    await markSubmissionsSpamRetro(db, [fresh.id], "retro:repeat-sender");
    const after = await getSubmissionById(db, fresh.id);
    expect(after?.status).toBe("spam_auto");
    expect(after?.spamReason).toBe("retro:repeat-sender");
  });

  it("appends to an existing spam_reason instead of clobbering the classifier trail", async () => {
    await markSubmissionsSpamRetro(db, [scored.id], "retro:duplicate-body");
    const after = await getSubmissionById(db, scored.id);
    expect(after?.status).toBe("spam_auto");
    expect(after?.spamReason).toBe("links:1,retro:duplicate-body");
  });

  it("leaves non-'new' rows untouched even when their id is passed (operator wins)", async () => {
    await markSubmissionsSpamRetro(db, [read.id], "retro:repeat-sender");
    const after = await getSubmissionById(db, read.id);
    expect(after?.status).toBe("read");
    expect(after?.spamReason).toBeNull();
  });

  it("only touches the given ids", async () => {
    await markSubmissionsSpamRetro(db, [fresh.id], "retro:repeat-sender");
    const after = await getSubmissionById(db, bystander.id);
    expect(after?.status).toBe("new");
    expect(after?.spamReason).toBeNull();
  });

  it("handles a mixed batch in one call (flips the new, skips the read)", async () => {
    await markSubmissionsSpamRetro(db, [fresh.id, read.id, scored.id], "retro:duplicate-body");
    expect((await getSubmissionById(db, fresh.id))?.status).toBe("spam_auto");
    expect((await getSubmissionById(db, scored.id))?.status).toBe("spam_auto");
    expect((await getSubmissionById(db, read.id))?.status).toBe("read");
  });

  it("is a no-op on an empty id list", async () => {
    await expect(markSubmissionsSpamRetro(db, [], "retro:repeat-sender")).resolves.toBeUndefined();
    expect((await getSubmissionById(db, fresh.id))?.status).toBe("new");
  });
});
