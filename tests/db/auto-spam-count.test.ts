import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, countAutoSpamSince } from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  // two spam_auto rows in-window, one spam_auto out-of-window, one manual spam
  // in-window (must NOT count), one clean row.
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "A",
    email: "a@x.com",
    submittedAt: new Date("2026-06-25T00:00:00.000Z"),
    status: "spam_auto",
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "B",
    email: "b@x.com",
    submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    status: "spam_auto",
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Old",
    email: "old@x.com",
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    status: "spam_auto",
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Manual",
    email: "m@x.com",
    submittedAt: new Date("2026-06-26T00:00:00.000Z"),
    status: "spam",
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Clean",
    email: "c@x.com",
    submittedAt: new Date("2026-06-27T00:00:00.000Z"),
  });
});

describe("countAutoSpamSince", () => {
  it("counts only spam_auto rows on/after the window start, fleet-wide", async () => {
    expect(await countAutoSpamSince(db, "2026-06-20")).toBe(2);
  });
  it("returns 0 when nothing is in-window", async () => {
    expect(await countAutoSpamSince(db, "2026-07-01")).toBe(0);
  });
});
