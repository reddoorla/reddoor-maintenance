import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { listFleetEvents, type FleetEvent } from "../../src/db/fleet-events.js";
import { recordFleetEventsBestEffort } from "../../src/audits/fleet-events-writer.js";

const NOW = new Date("2026-06-25T07:00:00.000Z");

function ev(id: string, ts: string): FleetEvent {
  return { id, ts, type: "fleet_swept", siteId: null, siteName: null, summary: id, data: null };
}

describe("recordFleetEventsBestEffort", () => {
  it("writes all events and prunes the 30-day window via the injected opener", async () => {
    const db = await openDb({ url: ":memory:" });
    const open = () => Promise.resolve(db);
    await recordFleetEventsBestEffort(
      [ev("keep", "2026-06-24T00:00:00.000Z"), ev("old", "2026-05-01T00:00:00.000Z")],
      NOW,
      open,
    );
    const rows = await listFleetEvents(db, { sinceIso: "2026-01-01T00:00:00.000Z", limit: 50 });
    // "old" (>30d before NOW) is pruned; "keep" survives.
    expect(rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("is a no-op (resolves, never throws) on an empty list", async () => {
    let opened = false;
    await recordFleetEventsBestEffort([], NOW, () => {
      opened = true;
      return Promise.reject(new Error("should not open"));
    });
    expect(opened).toBe(false);
  });

  it("swallows an opener failure (missing creds) without throwing", async () => {
    await expect(
      recordFleetEventsBestEffort([ev("a", "2026-06-24T00:00:00.000Z")], NOW, () =>
        Promise.reject(new Error("TURSO_DATABASE_URL not set")),
      ),
    ).resolves.toBeUndefined();
  });
});
