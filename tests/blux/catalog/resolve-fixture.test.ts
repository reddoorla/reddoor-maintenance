import { describe, it, expect } from "vitest";
import { resolveFixture } from "../../../src/blux/catalog/resolve-fixture.js";

const plan = {
  customTypes: [],
  documents: [
    {
      type: "page",
      uid: "home",
      data: {
        title: { __richtext_html: "<h1>The Pointe</h1>" },
        slices: [
          {
            slice_type: "blux_grid",
            variation: "default",
            primary: {
              cells: [
                { title: { __richtext_html: "<h3>Card</h3>" }, media: { __asset_id: "asset-1" } },
              ],
            },
          },
        ],
      },
    },
  ],
  assets: [{ id: "asset-1", url: "https://cdn/img.jpg", alt: "Card art" }],
  stylesManifest: [],
  diagnostics: [],
};

describe("resolveFixture", () => {
  it("richtext markers become node arrays; asset markers become url image fields", () => {
    const fx = resolveFixture(plan as never);
    const doc = fx.documents[0]!;
    expect(Array.isArray(doc.data.title)).toBe(true);
    expect((doc.data.title as { type: string }[])[0]!.type).toBe("heading1");
    const cell = (doc.data.slices as any[])[0].primary.cells[0];
    // The richtext marker inside a cell resolves too (deep walk).
    expect((cell.title as { type: string }[])[0]!.type).toBe("heading3");
    expect(cell.media).toMatchObject({
      url: "https://cdn/img.jpg",
      alt: "Card art",
      dimensions: { width: 1600, height: 1200 },
    });
  });

  it("unknown asset ids resolve to null media (isFilled-safe), reported", () => {
    const broken = { ...plan, assets: [] };
    const fx = resolveFixture(broken as never);
    const cell = (fx.documents[0]!.data.slices as any[])[0].primary.cells[0];
    expect(cell.media).toBeNull();
    expect(fx.missingAssets).toEqual(["asset-1"]);
  });

  it("groups entity documents by type for SliceZone context.collections", () => {
    const withEntity = {
      ...plan,
      documents: [
        ...plan.documents,
        {
          type: "product",
          uid: "steel-chair",
          data: { title: { __richtext_html: "<h1>Steel Chair</h1>" }, tags: "metal" },
        },
      ],
    };
    const fx = resolveFixture(withEntity as never);
    // pages stay in documents; entities are grouped by type, not in documents.
    expect(fx.documents).toHaveLength(1);
    expect(fx.collections.product).toHaveLength(1);
    expect(fx.collections.product![0]!.uid).toBe("steel-chair");
    // entity richtext resolves too.
    expect((fx.collections.product![0]!.data.title as { type: string }[])[0]!.type).toBe("heading1");
  });
});
