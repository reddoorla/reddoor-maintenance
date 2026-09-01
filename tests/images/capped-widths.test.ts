import { describe, it, expect } from "vitest";
import {
  cappedWidths,
  PRISMIC_DEFAULT_WIDTHS,
  type ImageFieldLike,
} from "../../src/images/index.js";

const field = (width: number | null | undefined): ImageFieldLike =>
  ({ dimensions: { width } }) as ImageFieldLike;

const DEFAULTS = [...PRISMIC_DEFAULT_WIDTHS];

describe("images/cappedWidths", () => {
  it("matches the width list @prismicio/client actually ships", () => {
    // If Prismic changes its defaults, capping still works but the "unchanged"
    // branch would silently start trimming — pin the list so that surfaces.
    expect(DEFAULTS).toEqual([640, 828, 1200, 2048, 3840]);
  });

  it("collapses to the native width when the source is smaller than every candidate", () => {
    // revogen /about: a 558x471 photo that was advertising a 3840w candidate.
    expect(cappedWidths(field(558))).toEqual([558]);
  });

  it("keeps candidates below the source and caps the top at the native width", () => {
    expect(cappedWidths(field(768))).toEqual([640, 768]);
    expect(cappedWidths(field(1920))).toEqual([640, 828, 1200, 1920]);
    expect(cappedWidths(field(3002))).toEqual([640, 828, 1200, 2048, 3002]);
  });

  it("never offers a candidate wider than the source", () => {
    for (const width of [40, 280, 360, 494, 558, 640, 720, 768, 1920, 3002, 3839]) {
      expect(Math.max(...cappedWidths(field(width)))).toBeLessThanOrEqual(width);
    }
  });

  it("leaves the default list untouched once the source reaches the widest candidate", () => {
    // Appending the native width here would ADD a candidate wider than any
    // previously offered, making large images heavier rather than lighter.
    expect(cappedWidths(field(3840))).toEqual(DEFAULTS);
    expect(cappedWidths(field(4168))).toEqual(DEFAULTS);
    expect(cappedWidths(field(4795))).toEqual(DEFAULTS);
  });

  it("falls back to the candidate list for empty or dimensionless fields", () => {
    expect(cappedWidths(null)).toEqual(DEFAULTS);
    expect(cappedWidths(undefined)).toEqual(DEFAULTS);
    expect(cappedWidths({} as ImageFieldLike)).toEqual(DEFAULTS);
    expect(cappedWidths({ dimensions: null })).toEqual(DEFAULTS);
    expect(cappedWidths(field(null))).toEqual(DEFAULTS);
    expect(cappedWidths(field(undefined))).toEqual(DEFAULTS);
  });

  it("ignores nonsense dimensions rather than emitting a broken srcset", () => {
    expect(cappedWidths(field(0))).toEqual(DEFAULTS);
    expect(cappedWidths(field(-100))).toEqual(DEFAULTS);
    expect(cappedWidths(field(Number.NaN))).toEqual(DEFAULTS);
    expect(cappedWidths(field(Number.POSITIVE_INFINITY))).toEqual(DEFAULTS);
  });

  it("honours a caller-supplied candidate list", () => {
    expect(cappedWidths(field(500), [220, 440, 660])).toEqual([220, 440, 500]);
    expect(cappedWidths(field(900), [220, 440, 660])).toEqual([220, 440, 660]);
  });

  it("does not mutate the caller's array", () => {
    const custom = [220, 440, 660];
    cappedWidths(field(500), custom);
    expect(custom).toEqual([220, 440, 660]);
  });

  it("returns a fresh array each call so callers can't alias the defaults", () => {
    const a = cappedWidths(null);
    a.push(9999);
    expect(cappedWidths(null)).toEqual(DEFAULTS);
  });
});
