import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";

describe("0003/0004 spam-score migrations", () => {
  it("add spam_score/spam_reason columns and round-trip a scored row", async () => {
    const db = await openDb({ url: ":memory:" });
    await db
      .insertInto("submissions")
      .values({
        id: "sub_spam_1",
        submission_id: 1,
        site_id: "recSITE",
        form_type: "contact",
        name: "Spammy McBot",
        email: "bot@mailinator.com",
        phone: null,
        message: "buy now http://x http://y http://z",
        extra_fields: null,
        source_url: null,
        utm: null,
        submitted_at: "2026-07-01T00:00:00.000Z",
        status: "spam_auto",
        notify_status: "skipped",
        resend_message_id: null,
        spam_score: 120,
        spam_reason: "links:3,disposable-email",
      })
      .execute();

    const rows = await db.selectFrom("submissions").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spam_score).toBe(120);
    expect(rows[0]!.spam_reason).toBe("links:3,disposable-email");
  });
});
