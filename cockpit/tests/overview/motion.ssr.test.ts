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
  countable,
  countFrame,
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

/** P1-87 PR 8a, item 4: the count-up's pure helpers. */
describe("the count-up's helpers (P1-87 PR 8a, item 4)", () => {
  it("counts only a figure of digits with optional thousands commas", () => {
    for (const s of ["0", "248", "1,674", "12,345,678"]) expect(countable(s), s).toBe(true);
    for (const s of [
      "not yet collected",
      "could not be read",
      "—",
      "",
      "1,67",
      "12,34",
      "1234,567",
    ])
      expect(countable(s), s).toBe(false);
  });

  it("writes the model's string exactly at the last frame", () => {
    for (const s of ["1,674", "248", "0", "12,345,678"]) expect(countFrame(s, 1), s).toBe(s);
  });

  it("counts from 0 with an ease-out curve, keeping the model's commas", () => {
    expect(countFrame("1,674", 0)).toBe("0");
    expect(countFrame("1,674", 0.5)).toBe("1,465");
    expect(countFrame("248", 0.5)).toBe("217");
    expect(countFrame("0", 0.5)).toBe("0");
  });

  it("never shows a number above the model's, nor a longer string", () => {
    for (const s of ["1,674", "248", "12,345,678"]) {
      const n = Number(s.replace(/,/g, ""));
      for (let k = 0; k <= 100; k++) {
        const f = countFrame(s, k / 100);
        expect(Number(f.replace(/,/g, "")), `${s} at ${k}%`).toBeLessThanOrEqual(n);
        expect(f.length, `${s} at ${k}%`).toBeLessThanOrEqual(s.length);
      }
    }
  });
});
