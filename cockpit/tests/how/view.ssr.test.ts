import { describe, it, expect } from "vitest";
import { nextToLight, STEP_LIGHT_MS, LEAD_DOT_MS } from "../../src/lib/how/view.js";

/**
 * PR 8c item 8 (plans/2026-11-16-p1-87-overview-reorg/pr8-motion-plan.md, "8c"): the night's
 * steps light in order as they scroll into view. The ordering rule is a pure function so the
 * mutants on it are caught here, not only in a browser.
 */
describe("PR 8c item 8: the steps light in order", () => {
  it("a step lights once it has been seen and nothing above it is unlit", () => {
    expect(nextToLight([true, true], [false, false])).toBe(0);
    expect(nextToLight([true, true], [true, false])).toBe(1);
  });

  it("nothing lights before a step has been seen", () => {
    expect(nextToLight([false, false], [false, false])).toBeNull();
    expect(nextToLight([false, true], [false, false])).toBeNull();
  });

  it("a step that enters before the one above it waits for that step", () => {
    expect(nextToLight([false, true, true], [false, false, false])).toBeNull();
    expect(nextToLight([true, false, true], [true, false, false])).toBeNull();
  });

  it("nothing is left to light once every step is lit", () => {
    expect(nextToLight([true, true], [true, true])).toBeNull();
  });

  it("each step takes 300 ms, the length of its transition", () => {
    expect(STEP_LIGHT_MS).toBe(300);
  });

  it("the whole run stays under five seconds, the plan's ceiling for moving things", () => {
    expect(STEP_LIGHT_MS * 8).toBeLessThanOrEqual(5_000);
  });
});

/**
 * PR 8c item 9 (pr8-motion-plan.md, "8c"): the lead's dot runs once, across the journey, in 3.5 s.
 */
describe("PR 8c item 9: the lead's dot runs once, in 3.5 s", () => {
  it("the dot's run is 3.5 s, a named constant", () => {
    expect(LEAD_DOT_MS).toBe(3500);
  });

  it("the run stays under five seconds, the plan's ceiling for moving things", () => {
    expect(LEAD_DOT_MS).toBeLessThanOrEqual(5_000);
  });
});
