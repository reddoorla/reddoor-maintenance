import { describe, it, expect, vi } from "vitest";

/**
 * The guard's own instrument check.
 *
 * `vitest.time-travel-setup.ts` is worthless if it silently fails to apply: the suite runs
 * on the real clock, every test passes, and the run reports a confident green that proves
 * nothing. That is not hypothetical — the first version of the shim set the clock inside
 * `beforeAll`, was reverted by the test files' own hooks, and reported exactly that.
 *
 * So the guard asserts on itself. If the shift did not land, THIS fails and the scheduled
 * run goes red for a reason that names the shim rather than blaming a random test.
 *
 * `vi.getRealSystemTime()` reports true wall time even while the clock is faked, so the
 * delta between it and `Date.now()` is the shift actually in effect.
 */
const raw = process.env.REDDOOR_TIME_TRAVEL_DAYS?.trim();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe.runIf(Boolean(raw))("time-travel guard — the shim actually moved the clock", () => {
  it("shifts Date.now() forward by REDDOOR_TIME_TRAVEL_DAYS", () => {
    const days = Number(raw);
    expect(Number.isFinite(days) && days > 0).toBe(true);

    const shiftMs = Date.now() - vi.getRealSystemTime();
    const shiftDays = shiftMs / MS_PER_DAY;

    // Generous tolerance: the suite takes minutes to run and `shouldAdvanceTime` lets the
    // faked clock tick, so the delta drifts slightly. An unapplied shim reads ~0 days,
    // which is nowhere near the target — this distinguishes those two cases and no more.
    expect(shiftDays).toBeGreaterThan(days - 1);
    expect(shiftDays).toBeLessThan(days + 1);
  });

  it("puts the suite's clock in the future, not the past", () => {
    expect(Date.now()).toBeGreaterThan(vi.getRealSystemTime());
  });
});

/** Without the env var the shim must NOT be loaded — `pnpm test` stays on the real clock. */
describe.runIf(!raw)("time-travel guard — dormant by default", () => {
  it("leaves the clock alone when REDDOOR_TIME_TRAVEL_DAYS is unset", () => {
    expect(Math.abs(Date.now() - vi.getRealSystemTime())).toBeLessThan(1000);
  });
});
