import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, getSubmissionById } from "../../src/db/submissions.js";

describe("db createSubmission / getSubmissionById", () => {
  it("inserts a row with an opaque id, display number 1, and round-trips it", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recSITE",
      formType: "contact",
      name: "Ada",
      email: "ada@example.com",
      phone: "555",
      message: "hi",
      extraFields: { artwork: "Sunset" },
      sourceUrl: "https://acme.test/contact",
      utm: "utm_source=google",
      submittedAt: new Date("2026-06-22T12:00:00.000Z"),
    });
    expect(row.id).toMatch(/^sub_/);
    expect(row.submissionId).toBe(1);
    expect(row.status).toBe("new");
    expect(row.notifyStatus).toBe("skipped");
    expect(row.extraFields).toBe(JSON.stringify({ artwork: "Sunset" }));
    expect(row.phone).toBe("555");

    const fetched = await getSubmissionById(db, row.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBe("ada@example.com");
    expect(fetched!.submittedAt).toBe("2026-06-22T12:00:00.000Z");
  });

  it("assigns monotonically increasing display numbers", async () => {
    const db = await openDb({ url: ":memory:" });
    const a = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    const b = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "B",
      email: "b@example.com",
      submittedAt: new Date("2026-06-22T00:00:01.000Z"),
    });
    expect(a.submissionId).toBe(1);
    expect(b.submissionId).toBe(2);
  });

  it("omits extra_fields when empty", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      extraFields: {},
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    expect(row.extraFields).toBeNull();
  });

  it("returns null for a missing id", async () => {
    const db = await openDb({ url: ":memory:" });
    expect(await getSubmissionById(db, "sub_nope")).toBeNull();
  });
});

import {
  listNewSubmissions,
  listSubmissionsForSite,
  setSubmissionStatusRow,
  stampNotified,
} from "../../src/db/submissions.js";

async function seed(db: Awaited<ReturnType<typeof openDb>>) {
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Old A",
    email: "olda@example.com",
    submittedAt: new Date("2026-06-20T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "New A",
    email: "newa@example.com",
    submittedAt: new Date("2026-06-22T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "B",
    email: "b@example.com",
    submittedAt: new Date("2026-06-21T00:00:00.000Z"),
  });
}

describe("db list / status / stamp", () => {
  it("listNewSubmissions returns only new rows, newest first", async () => {
    const db = await openDb({ url: ":memory:" });
    await seed(db);
    const all = await listNewSubmissions(db);
    expect(all.map((s) => s.name)).toEqual(["New A", "B", "Old A"]);
    // Flip one out of "new" and confirm it drops from the queue.
    const first = all[0]!;
    await setSubmissionStatusRow(db, first.id, "read");
    const rest = await listNewSubmissions(db);
    expect(rest.find((s) => s.id === first.id)).toBeUndefined();
  });

  it("listNewSubmissions caps at max (bounds the cockpit fleet-wide load), newest first", async () => {
    const db = await openDb({ url: ":memory:" });
    await seed(db); // 3 "new" rows
    const capped = await listNewSubmissions(db, 2);
    expect(capped.map((s) => s.name)).toEqual(["New A", "B"]);
  });

  it("listSubmissionsForSite narrows by site id, newest first, honoring max", async () => {
    const db = await openDb({ url: ":memory:" });
    await seed(db);
    const a = await listSubmissionsForSite(db, { id: "recA", name: "Acme" });
    expect(a.map((s) => s.name)).toEqual(["New A", "Old A"]);
    const capped = await listSubmissionsForSite(db, { id: "recA", name: "Acme" }, 1);
    expect(capped.map((s) => s.name)).toEqual(["New A"]);
  });

  it("setSubmissionStatusRow updates status", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    await setSubmissionStatusRow(db, row.id, "spam");
    expect((await getSubmissionById(db, row.id))!.status).toBe("spam");
  });

  it("stampNotified sets notify status, and the message id only when present", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "A",
      email: "a@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    await stampNotified(db, row.id, "sent", "re_123");
    let got = (await getSubmissionById(db, row.id))!;
    expect(got.notifyStatus).toBe("sent");
    expect(got.resendMessageId).toBe("re_123");

    await stampNotified(db, row.id, "failed", null);
    got = (await getSubmissionById(db, row.id))!;
    expect(got.notifyStatus).toBe("failed");
    expect(got.resendMessageId).toBe("re_123"); // unchanged when messageId is null
  });
});
