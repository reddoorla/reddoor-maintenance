import { describe, it, expect } from "vitest";
import { sql } from "kysely";
import { openDb } from "../../src/db/client.js";

describe("openDb", () => {
  it("returns a Kysely whose connection already has the migrations applied", async () => {
    const db = await openDb({ url: ":memory:" });
    // Insert through Kysely, read it back — proves the dialect uses the migrated client.
    await db
      .insertInto("submissions")
      .values({
        id: "sub_test",
        submission_id: 1,
        site_id: "recSITE",
        form_type: "contact",
        name: "Ada",
        email: "ada@example.com",
        phone: null,
        message: null,
        extra_fields: null,
        source_url: null,
        utm: null,
        submitted_at: "2026-06-22T00:00:00.000Z",
        status: "new",
        notify_status: "skipped",
        resend_message_id: null,
      })
      .execute();
    const row = await db
      .selectFrom("submissions")
      .selectAll()
      .where("id", "=", "sub_test")
      .executeTakeFirst();
    expect(row?.name).toBe("Ada");
    // _migrations exists too (proves runMigrations ran on the same connection).
    const m = await sql<{ id: string }>`SELECT id FROM _migrations`.execute(db);
    expect(m.rows.map((r) => r.id)).toEqual([
      "0001_init",
      "0002_fleet_events",
      "0003_add_spam_score",
      "0004_add_spam_reason",
    ]);
    await db.destroy();
  });
});
