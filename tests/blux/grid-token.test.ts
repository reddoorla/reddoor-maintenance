import { describe, it, expect } from "vitest";
import { parseGridToken } from "../../src/blux/grid/token.js";

describe("parseGridToken", () => {
  it("reads an equal-column token", () => {
    expect(parseGridToken("block-subcontent cagriditem top grid-2 ")).toEqual({
      cols: 2,
      raw: "grid-2",
    });
    expect(parseGridToken("grid-4")).toEqual({ cols: 4, raw: "grid-4" });
    expect(parseGridToken("grid-1")).toEqual({ cols: 1, raw: "grid-1" });
  });
  it("reads a ratio split token", () => {
    expect(parseGridToken("cagriditem grid-2-r60")).toEqual({
      cols: 2,
      ratio: 60,
      raw: "grid-2-r60",
    });
    expect(parseGridToken("block-media-holder ibb top grid-2-r20 ")).toEqual({
      cols: 2,
      ratio: 20,
      raw: "grid-2-r20",
    });
  });
  it("reads an s-token as spacing (a gap), not a width", () => {
    expect(parseGridToken("cagriditem top grid-1-s40 ")).toEqual({
      cols: 1,
      spacing: 40,
      raw: "grid-1-s40",
    });
    expect(parseGridToken("grid-any-s20")).toEqual({
      cols: "any",
      spacing: 20,
      raw: "grid-any-s20",
    });
  });
  it("ignores grid-container and returns null when no token is present", () => {
    expect(parseGridToken("block-grid-container cagrid")).toBeNull();
    expect(parseGridToken("block-content valignmiddleitem")).toBeNull();
    expect(parseGridToken("")).toBeNull();
  });
});
