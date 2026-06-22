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
