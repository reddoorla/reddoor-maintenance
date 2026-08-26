/**
 * #612: the fleet sweep's mirror outcomes never reached the exit code.
 *
 * `writeFleetAuditsToAirtable` catches a per-site mirror failure and COUNTS it —
 * which is right, one bad site must not abort a 44-site sweep — but the counts
 * only ever reached the `FLEET_WRITE_SUMMARY` line, and no workflow gates on
 * them. Pre-freeze that is fine: the hourly import converges whatever a mirror
 * missed. Post-freeze there is nothing to converge it, so a sweep that failed to
 * write half the fleet's health into the only store would finish GREEN.
 *
 * `mirror_missed` matters as much as `mirror_failed` here. Pre-freeze it means
 * "site created in Airtable since the last import", a transient. Post-freeze
 * Turso is the only store, so a missed row means the row is gone.
 *
 * Both sides of the switch are injected as fixtures, with exactly one assertion
 * on the shipped constant living in tests/db/freeze-semantics.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  fleetWriteFailed,
  type FleetWriteResult,
} from "../../src/audits/write-audits-to-airtable.js";

const clean: FleetWriteResult = {
  written: [],
  failed: [],
  mirrored: 44,
  mirrorFailed: 0,
  mirrorMissed: 0,
};

describe("fleetWriteFailed", () => {
  it("a clean sweep passes on both sides of the freeze", () => {
    expect(fleetWriteFailed(clean, false)).toBe(false);
    expect(fleetWriteFailed(clean, true)).toBe(false);
  });

  it("an Airtable write failure fails on both sides", () => {
    const r = { ...clean, failed: [{ slug: "acme", error: "boom" }] };
    expect(fleetWriteFailed(r, false)).toBe(true);
    expect(fleetWriteFailed(r, true)).toBe(true);
  });

  it("a mirror failure is tolerated pre-freeze and FATAL after", () => {
    const r = { ...clean, mirrorFailed: 1 };
    // Pre-freeze the hourly import converges it — going red would page over a
    // transient the system already handles.
    expect(fleetWriteFailed(r, false)).toBe(false);
    expect(fleetWriteFailed(r, true)).toBe(true);
  });

  it("a missed row is tolerated pre-freeze and FATAL after", () => {
    const r = { ...clean, mirrorMissed: 1 };
    expect(fleetWriteFailed(r, false)).toBe(false);
    expect(fleetWriteFailed(r, true)).toBe(true);
  });

  it("post-freeze, an ABSENT mirror is fatal — no counts means nothing was written", () => {
    // The counters are absent entirely when no mirror was wired (no libSQL
    // creds). Pre-freeze that is a documented, survivable state. Post-freeze it
    // means the sweep wrote nothing at all to the only store there is, which is
    // the worst outcome of the three and the easiest to read as success.
    const r: FleetWriteResult = { written: [], failed: [] };
    expect(fleetWriteFailed(r, false)).toBe(false);
    expect(fleetWriteFailed(r, true)).toBe(true);
  });

  it("post-freeze, a wired mirror that landed everything still passes (positive control)", () => {
    // Without this, every assertion above would pass on a predicate that simply
    // returned true whenever strict was set.
    expect(fleetWriteFailed({ ...clean, mirrored: 44 }, true)).toBe(false);
  });
});
