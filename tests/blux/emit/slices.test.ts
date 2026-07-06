import { describe, it, expect } from "vitest";
import { sectionToSlice } from "../../../src/blux/emit/slices.js";

describe("sectionToSlice", () => {
  it("maps a hero section with rich-text + asset markers", () => {
    const s = sectionToSlice({
      sliceType: "hero",
      variation: "default",
      confidence: 0.9,
      fields: { heading: "<h1>Hi</h1>", body: "<p>b</p>", backgroundMedia: "img-1" },
    });
    expect(s.slice_type).toBe("hero");
    expect(s.primary.heading).toEqual({ __richtext_html: "<h1>Hi</h1>" });
    expect(s.primary.background_image).toEqual({ __asset_id: "img-1" });
  });
  it("maps a grid section's children to items", () => {
    const s = sectionToSlice({
      sliceType: "grid",
      variation: "default",
      confidence: 0.9,
      fields: { heading: "<h2>Grid</h2>" },
      children: [
        {
          sliceType: "media_text",
          variation: "imageRight",
          confidence: 0.9,
          fields: { heading: "<h3>c</h3>", media: "img-2" },
        },
      ],
    });
    expect(s.slice_type).toBe("section_grid");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.item_media).toEqual({ __asset_id: "img-2" });
  });
  it("maps media_text imageLeft variation", () => {
    const s = sectionToSlice({
      sliceType: "media_text",
      variation: "imageLeft",
      confidence: 0.9,
      fields: { heading: "<h2>x</h2>", media: "m" },
    });
    expect(s.variation).toBe("imageLeft");
  });
  it("maps collection_list with its linked apiId", () => {
    const s = sectionToSlice({
      sliceType: "collection_list",
      variation: "grid",
      confidence: 0.9,
      fields: { heading: "<h2>Products</h2>" },
      collectionRef: { apiId: "product", mode: "all", wired: true },
    });
    expect(s.primary.collection_type).toBe("product");
  });
});
