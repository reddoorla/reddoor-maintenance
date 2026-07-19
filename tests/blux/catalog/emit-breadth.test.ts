import { describe, it, expect } from "vitest";
import type {
  BluxBlockSpec,
  BluxCarouselSpec,
  BluxGallerySpec,
  BluxGridSpec,
  BluxMediaSpec,
  BluxMediaTextSpec,
} from "../../../src/blux/catalog/index.js";
import {
  buildCatalogPlan,
  catalogSpecToPlanSlice,
} from "../../../src/blux/catalog/index.js";
import type { Media } from "../../../src/blux/grid/types.js";

const img = (id: string): Media => ({
  kind: "image",
  assetId: id,
  base: "https://cdn/",
  ext: "jpg",
});

describe("catalogSpecToPlanSlice — breadth", () => {
  it("BluxMediaText → blux_media_text with media/side/ratio + rich-text markers", () => {
    const spec: BluxMediaTextSpec = {
      slice: "BluxMediaText",
      index: 0,
      mediaSide: "left",
      layoutRatio: 60,
      media: img("m1"),
      title: "<h3>Suites</h3>",
      body: "<p>Roomy</p>",
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_media_text");
    expect(slice.variation).toBe("default");
    expect(slice.items).toEqual([]);
    expect(slice.primary.media).toEqual({ __asset_id: "m1" });
    expect(slice.primary.media_side).toBe("left");
    expect(slice.primary.layout_ratio).toBe(60);
    expect(slice.primary.title).toEqual({ __richtext_html: "<h3>Suites</h3>" });
    expect(slice.primary.body).toEqual({ __richtext_html: "<p>Roomy</p>" });
  });

  it("BluxGallery → blux_gallery with one media cell per Media", () => {
    const spec: BluxGallerySpec = {
      slice: "BluxGallery",
      index: 1,
      heading: "<h2>Gallery</h2>",
      cells: [
        { kind: "media", media: img("g1") },
        { kind: "media", media: img("g2") },
      ],
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_gallery");
    expect(slice.primary.heading).toEqual({ __richtext_html: "<h2>Gallery</h2>" });
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ kind: "media", media: { __asset_id: "g1" } });
    expect(cells[1]).toMatchObject({ kind: "media", media: { __asset_id: "g2" } });
  });

  it("BluxCarousel → blux_carousel with columns_visible + captioned media cells", () => {
    const spec: BluxCarouselSpec = {
      slice: "BluxCarousel",
      index: 2,
      columnsVisible: 3,
      cells: [
        { kind: "media", media: img("c1"), title: "<p>One</p>" },
        { kind: "media", media: img("c2") },
      ],
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_carousel");
    expect(slice.primary.columns_visible).toBe(3);
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      kind: "media",
      media: { __asset_id: "c1" },
      title: { __richtext_html: "<p>One</p>" },
    });
  });

  it("BluxGrid → blux_grid with columns + cells incl. a subgrid whose items carry markers", () => {
    const spec: BluxGridSpec = {
      slice: "BluxGrid",
      index: 3,
      heading: "<h2>Plans</h2>",
      columns: 3,
      cells: [
        { kind: "text", title: "<h3>A</h3>", body: "<p>a</p>" },
        {
          kind: "subgrid",
          subgrid: [
            { kind: "media", media: img("s1") },
            { kind: "text", body: "<p>deep</p>" },
          ],
        },
      ],
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_grid");
    expect(slice.primary.columns).toBe(3);
    expect(slice.primary.heading).toEqual({ __richtext_html: "<h2>Plans</h2>" });
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      kind: "text",
      title: { __richtext_html: "<h3>A</h3>" },
    });
    const sub = (cells[1] as { subgrid: Record<string, unknown>[] }).subgrid;
    expect(cells[1]?.kind).toBe("subgrid");
    expect(sub).toHaveLength(2);
    expect(sub[0]).toMatchObject({ kind: "media", media: { __asset_id: "s1" } });
    expect(sub[1]).toMatchObject({ kind: "text", body: { __richtext_html: "<p>deep</p>" } });
  });

  it("BluxMedia → blux_media with media asset + caption marker", () => {
    const spec: BluxMediaSpec = {
      slice: "BluxMedia",
      index: 4,
      media: img("v1"),
      caption: "<p>The pool</p>",
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_media");
    expect(slice.primary.media).toEqual({ __asset_id: "v1" });
    expect(slice.primary.caption).toEqual({ __richtext_html: "<p>The pool</p>" });
  });

  it("BluxBlock → blux_block with a JSON-string payload preserving media url + html", () => {
    const spec: BluxBlockSpec = {
      slice: "BluxBlock",
      index: 5,
      payload: {
        tag: "div",
        children: [
          { tag: "h3", html: "<h3>Deep</h3>" },
          { tag: "figure", image: { url: "https://cdn/b9.jpg", alt: "" } },
        ],
      },
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_block");
    expect(typeof slice.primary.payload).toBe("string");
    const payload = slice.primary.payload as string;
    expect(payload).toContain("https://cdn/b9.jpg");
    expect(payload).toContain("Deep");
    // Round-trips as JSON (the starter's BluxBlock parses it).
    expect(JSON.parse(payload)).toEqual(spec.payload);
  });

  it("emits embed_html for an embed cell", () => {
    const spec: BluxGridSpec = {
      slice: "BluxGrid",
      index: 6,
      cells: [{ kind: "embed", embedHtml: "<iframe src='x'></iframe>" }],
    };
    const slice = catalogSpecToPlanSlice(spec);
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells[0]).toMatchObject({
      kind: "embed",
      embed_html: "<iframe src='x'></iframe>",
    });
  });
});

describe("buildCatalogPlan — breadth media collection", () => {
  it("collects media from BluxMedia, BluxMediaText, and container cells incl. subgrid", () => {
    const specs = [
      {
        slice: "BluxMedia",
        index: 0,
        media: img("a1"),
      } satisfies BluxMediaSpec,
      {
        slice: "BluxMediaText",
        index: 1,
        mediaSide: "right",
        media: img("a2"),
        background: img("a3"),
      } satisfies BluxMediaTextSpec,
      {
        slice: "BluxGrid",
        index: 2,
        cells: [
          { kind: "media", media: img("a4") },
          { kind: "subgrid", subgrid: [{ kind: "media", media: img("a5") }] },
        ],
      } satisfies BluxGridSpec,
    ];
    const plan = buildCatalogPlan(
      [{ uid: "home", title: "Home", specs }],
      { assets: [], diagnostics: [] },
    );
    const ids = plan.assets.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["a1", "a2", "a3", "a4", "a5"]));
  });
});
