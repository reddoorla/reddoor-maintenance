import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NIGHTLY_CRON,
  SEND_CRON,
  nextDailyFiring,
  pacificTimeOfCron,
} from "../../src/dashboard/nightly-schedule.js";

/** P1-78g: the overview shows the clocks' times, worked out from their crons. */

const read = (f: string) =>
  readFileSync(new URL(`../../netlify/functions/${f}`, import.meta.url), "utf8");

describe("the clocks' schedules", () => {
  it("match the Netlify functions' own literals", () => {
    expect(read("nightly-clock.mts")).toContain(`schedule: "${NIGHTLY_CRON}"`);
    expect(read("nightly-send-clock.mts")).toContain(`schedule: "${SEND_CRON}"`);
  });

  it("the next firing is today's when it is still ahead, else tomorrow's", () => {
    expect(nextDailyFiring("7 6 * * *", new Date("2026-10-27T05:00:00Z")).toISOString()).toBe(
      "2026-10-27T06:07:00.000Z",
    );
    expect(nextDailyFiring("7 6 * * *", new Date("2026-10-27T06:08:00Z")).toISOString()).toBe(
      "2026-10-28T06:07:00.000Z",
    );
  });

  it("reads in Pacific time, across the end of daylight saving (Nov 1)", () => {
    expect(pacificTimeOfCron(NIGHTLY_CRON, new Date("2026-10-31T12:00:00Z"))).toBe("11:07pm PT");
    // The firing at 06:07Z on Nov 2 is 10:07pm on Nov 1, after the change.
    expect(pacificTimeOfCron(NIGHTLY_CRON, new Date("2026-11-01T12:00:00Z"))).toBe("10:07pm PT");
    expect(pacificTimeOfCron(SEND_CRON, new Date("2026-11-02T00:00:00Z"))).toBe("8:07am PT");
  });

  it("refuses a cron that is not daily", () => {
    expect(() => nextDailyFiring("*/5 * * * *", new Date())).toThrow(/not a daily cron/);
  });
});
