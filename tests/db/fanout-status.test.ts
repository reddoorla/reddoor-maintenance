import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, getSubmissionById, stampFanout } from "../../src/db/submissions.js";

async function seedNewsletter(db: Awaited<ReturnType<typeof openDb>>) {
  return createSubmission(db, {
    siteId: "recSITE",
    formType: "newsletter",
    name: "",
    email: "sub@example.com",
    submittedAt: new Date("2026-07-23T04:34:11.616Z"),
  });
}

describe("0005 fanout_status migration", () => {
  it("adds the column and round-trips a recorded fan-out", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await seedNewsletter(db);
    // A fresh row has attempted nothing yet.
    expect(row.fanoutStatus).toBeNull();

    await db
      .updateTable("submissions")
      .set({ fanout_status: "webhook:ok,mailchimp:401" })
      .where("id", "=", row.id)
      .execute();
    const reread = await getSubmissionById(db, row.id);
    expect(reread?.fanoutStatus).toBe("webhook:ok,mailchimp:401");
  });
});

describe("stampFanout", () => {
  it("writes the token list onto the row", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await seedNewsletter(db);
    await stampFanout(db, row.id, "mailchimp:ok");
    expect((await getSubmissionById(db, row.id))?.fanoutStatus).toBe("mailchimp:ok");
  });

  it("replaces a previous value rather than appending", async () => {
    const db = await openDb({ url: ":memory:" });
    const row = await seedNewsletter(db);
    await stampFanout(db, row.id, "mailchimp:401");
    await stampFanout(db, row.id, "mailchimp:ok");
    expect((await getSubmissionById(db, row.id))?.fanoutStatus).toBe("mailchimp:ok");
  });

  it("touches only the addressed row", async () => {
    const db = await openDb({ url: ":memory:" });
    const a = await seedNewsletter(db);
    const b = await seedNewsletter(db);
    await stampFanout(db, a.id, "mailchimp:ok");
    expect((await getSubmissionById(db, b.id))?.fanoutStatus).toBeNull();
  });
});
