/**
 * #612: the fleet sweep's mirror outcomes never reached the exit code.
 *
 * `writeFleetAudits` catches a per-site mirror failure and COUNTS it —
 * which is right, one bad site must not abort a 44-site sweep — but the counts
 * only ever reached the `FLEET_WRITE_SUMMARY` line, and no workflow gates on
 * them. Turso is the only store, so a sweep that failed to write half the
 * fleet's health into it would finish GREEN. A missed row matters as much as a
 * failed one: nothing imports the row it missed.
 */
import { describe, it, expect } from "vitest";
import { fleetWriteFailed, type FleetWriteResult } from "../../src/audits/write-audits.js";

const clean: FleetWriteResult = {
  written: [],
  failed: [],
  mirrored: 44,
  mirrorFailed: 0,
  mirrorMissed: 0,
};

describe("fleetWriteFailed", () => {
  it("a clean sweep passes (positive control)", () => {
    expect(fleetWriteFailed(clean)).toBe(false);
  });

  it("a failed site fails the run", () => {
    expect(fleetWriteFailed({ ...clean, failed: [{ slug: "acme", error: "boom" }] })).toBe(true);
  });

  it("a mirror failure is fatal", () => {
    expect(fleetWriteFailed({ ...clean, mirrorFailed: 1 })).toBe(true);
  });

  it("a missed row is fatal", () => {
    expect(fleetWriteFailed({ ...clean, mirrorMissed: 1 })).toBe(true);
  });

  it("an ABSENT mirror is fatal — no counts means nothing was written", () => {
    expect(fleetWriteFailed({ written: [], failed: [] })).toBe(true);
  });
});
