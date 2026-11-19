import { describe, it, expect } from "vitest";
import {
  BAR_MS,
  BAR_STAGGER_MS,
  COUNT_MS,
  SPARK_MS,
  FEED_MS,
  MAX_MOTION_MS,
  introPlayed,
  markIntroPlayed,
} from "../../src/lib/overview/motion.js";
import { HEALTH_CHECK_NAMES } from "../../src/lib/overview/view.js";

/** P1-87 PR 8a: the motion module's durations and its one intro flag. */
describe("the overview's motion module (P1-87 PR 8a)", () => {
  it("holds the plan's durations, and every one is within the five-second rule", () => {
    expect({ BAR_MS, BAR_STAGGER_MS, COUNT_MS, SPARK_MS, FEED_MS, MAX_MOTION_MS }).toEqual({
      BAR_MS: 600,
      BAR_STAGGER_MS: 80,
      COUNT_MS: 900,
      SPARK_MS: 900,
      FEED_MS: 400,
      MAX_MOTION_MS: 5000,
    });
    // The last bar's unknown segment ends after the last bar's fill: seven bars, stagger, two bars.
    expect((HEALTH_CHECK_NAMES.length - 1) * BAR_STAGGER_MS + 2 * BAR_MS).toBeLessThanOrEqual(
      MAX_MOTION_MS,
    );
    for (const ms of [BAR_MS, COUNT_MS, SPARK_MS, FEED_MS])
      expect(ms).toBeLessThanOrEqual(MAX_MOTION_MS);
  });

  it("starts with the intro unplayed, and marks it once", () => {
    expect(introPlayed()).toBe(false);
    markIntroPlayed();
    expect(introPlayed()).toBe(true);
    markIntroPlayed();
    expect(introPlayed()).toBe(true);
  });
});
