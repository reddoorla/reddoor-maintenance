import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";

describe("0002_fleet_events migration", () => {
  it("creates the fleet_events table with all columns and round-trips a row", async () => {
    const db = await openDb({ url: ":memory:" });
    await db
      .insertInto("fleet_events")
      .values({
        id: "fleet_swept:security:2026-06-25",
        ts: "2026-06-25T07:00:00.000Z",
        type: "fleet_swept",
        site_id: null,
        site_name: null,
        summary: "security-swept 11 sites",
        data: JSON.stringify({ sweep: "security", count: 11 }),
        created_at: "2026-06-25T07:00:01.000Z",
      })
      .execute();

    const rows = await db.selectFrom("fleet_events").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("fleet_swept:security:2026-06-25");
    expect(rows[0]!.site_id).toBeNull();
    expect(rows[0]!.summary).toBe("security-swept 11 sites");
  });
});
