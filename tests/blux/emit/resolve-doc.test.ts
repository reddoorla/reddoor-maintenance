import { describe, it, expect } from "vitest";
import { resolveDocData } from "../../../src/blux/emit/resolve-doc.js";

describe("resolveDocData", () => {
  it("converts richtext markers to nodes and asset markers to {id}, reporting misses", () => {
    const { data, missingAssets } = resolveDocData(
      {
        title: { __richtext_html: "<h1>Hi</h1>" },
        slices: [
          {
            slice_type: "hero",
            variation: "default",
            primary: {
              background_image: { __asset_id: "u1" },
              media: { __asset_id: "nope" },
            },
            items: [],
          },
        ],
      },
      new Map([["u1", "prismic-asset-1"]]),
    );
    expect(data.title).toEqual([expect.objectContaining({ type: "heading1", text: "Hi" })]);
    const primary = (data.slices as { primary: Record<string, unknown> }[])[0]!.primary;
    expect(primary.background_image).toEqual({ id: "prismic-asset-1" });
    expect(primary).not.toHaveProperty("media");
    expect(missingAssets).toEqual(["nope"]);
  });
});
