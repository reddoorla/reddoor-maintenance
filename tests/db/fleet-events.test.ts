import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  recordFleetEvent,
  listFleetEvents,
  pruneFleetEvents,
  type FleetEvent,
} from "../../src/db/fleet-events.js";

function ev(over: Partial<FleetEvent> & { id: string; ts: string }): FleetEvent {
  return {
    type: "pr_automerged",
    siteId: "recSITE",
    siteName: "Caltex",
    summary: "auto-merged vite→7.3.5",
    data: { url: "https://example.test/pr/1", repo: "reddoorla/caltex", number: 1 },
    ...over,
  };
}

describe("fleet-events db helpers", () => {
  it("records, lists newest-first, and round-trips JSON data", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "a", ts: "2026-06-20T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "b", ts: "2026-06-22T00:00:00.000Z" }));

    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]); // newest first
    expect(rows[0]!.data).toEqual({
      url: "https://example.test/pr/1",
      repo: "reddoorla/caltex",
      number: 1,
    });
  });

  it("is idempotent on the deterministic id (INSERT OR IGNORE)", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "dup", ts: "2026-06-22T00:00:00.000Z", summary: "first" }));
    await recordFleetEvent(db, ev({ id: "dup", ts: "2026-06-22T00:00:00.000Z", summary: "second" }));
    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toBe("first"); // the first write wins; the second is ignored
  });

  it("filters by sinceIso and respects limit", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "old", ts: "2026-05-01T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "new1", ts: "2026-06-22T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "new2", ts: "2026-06-23T00:00:00.000Z" }));

    const since = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(since.map((r) => r.id)).toEqual(["new2", "new1"]); // "old" excluded

    const limited = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 1 });
    expect(limited.map((r) => r.id)).toEqual(["new2"]);
  });

  it("prunes events strictly before the cutoff", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, ev({ id: "old", ts: "2026-05-01T00:00:00.000Z" }));
    await recordFleetEvent(db, ev({ id: "keep", ts: "2026-06-22T00:00:00.000Z" }));
    await pruneFleetEvents(db, "2026-06-01T00:00:00.000Z");
    const rows = await listFleetEvents(db, { sinceIso: "2026-01-01T00:00:00.000Z", limit: 10 });
    expect(rows.map((r) => r.id)).toEqual(["keep"]);
  });

  it("handles null data and null site fields", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordFleetEvent(db, {
      id: "fleet_swept:security:2026-06-25",
      ts: "2026-06-25T07:00:00.000Z",
      type: "fleet_swept",
      siteId: null,
      siteName: null,
      summary: "security-swept 11 sites",
      data: null,
    });
    const rows = await listFleetEvents(db, { sinceIso: "2026-06-01T00:00:00.000Z", limit: 10 });
    expect(rows[0]!.siteId).toBeNull();
    expect(rows[0]!.data).toBeNull();
  });
});
