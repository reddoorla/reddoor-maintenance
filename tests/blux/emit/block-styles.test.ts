import { describe, it, expect } from "vitest";
import { blockStylesByIndex } from "../../../src/blux/emit/block-styles.js";

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
