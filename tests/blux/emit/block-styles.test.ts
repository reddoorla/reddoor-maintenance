import { describe, it, expect } from "vitest";
import { blockClassDefaults, blockStylesByIndex } from "../../../src/blux/emit/block-styles.js";

describe("blockStylesByIndex", () => {
  it("cleans + keys each top-level block's styles by its position", () => {
    const siteJson = {
      content: {
        pages: [
          {
            items: [
              { styles: { "background-color": "#fff", "min-height": "100vh" } },
              { styles: {} },
              { styles: { "text-align": "center", "z-index": 10 } }, // numeric kept as string
            ],
          },
        ],
      },
    };
    const map = blockStylesByIndex(siteJson);
    expect(map.get(0)).toEqual({ "background-color": "#fff", "min-height": "100vh" });
    expect(map.has(1)).toBe(false); // empty → no entry
    expect(map.get(2)).toEqual({ "text-align": "center", "z-index": "10" });
  });

  it("returns an empty map when there are no pages/items", () => {
    expect(blockStylesByIndex({}).size).toBe(0);
    expect(blockStylesByIndex({ content: { pages: [] } }).size).toBe(0);
  });
});

describe("blockClassDefaults", () => {
  it("keys .blocksNcontainer entries by blocksN with padding/mobilePadding/maxWidth", () => {
    // The real the-pointe styles.blocks shape: a position-stable array of
    // { _label, ".blocksN": …, ".blocksNcontainer": … } slots.
    const siteJson = {
      styles: {
        blocks: [
          {
            _label: "Block (Default)",
            ".blocks0": { position: "relative" },
            ".blocks0container": {
              "box-sizing": "border-box",
              "max-width": "1280px",
              margin: "0 auto",
              padding: "120px 4% 120px 4%",
              __media_mobile_padding: "80px 4% 80px 4%",
            },
          },
          {
            _label: "Special Grid Spacer Block",
            ".blocks2": { position: "relative" },
            ".blocks2container": {
              "max-width": "1280px",
              padding: "40px 0",
              __media_mobile_padding: "20px 0",
            },
            ".blocks2:hover": {},
          },
        ],
      },
    };
    const map = blockClassDefaults(siteJson);
    expect(map.get("blocks0")).toEqual({
      padding: "120px 4% 120px 4%",
      mobilePadding: "80px 4% 80px 4%",
      maxWidth: "1280px",
    });
    expect(map.get("blocks2")).toEqual({
      padding: "40px 0",
      mobilePadding: "20px 0",
      maxWidth: "1280px",
    });
    expect(map.has("blocks2container")).toBe(false); // keyed by the bare class
  });

  it("drops malformed values and omits an all-empty container entry", () => {
    const siteJson = {
      styles: {
        blocks: [
          // padding "px" is the export's malformed tombstone — cleaned away,
          // leaving only the surviving max-width.
          { ".blocks0container": { padding: "px", "max-width": "1280px" } },
          { ".blocks1container": { padding: "", __media_mobile_padding: "" } },
        ],
      },
    };
    const map = blockClassDefaults(siteJson);
    expect(map.get("blocks0")).toEqual({ maxWidth: "1280px" });
    expect(map.has("blocks1")).toBe(false);
  });

  it("tolerates absent/malformed styles.blocks", () => {
    expect(blockClassDefaults({}).size).toBe(0);
    expect(blockClassDefaults({ styles: {} }).size).toBe(0);
    expect(blockClassDefaults({ styles: { blocks: "nope" } }).size).toBe(0);
    expect(blockClassDefaults({ styles: { blocks: [null, "x", { ".blocks0": null }] } }).size).toBe(
      0,
    );
  });
});
