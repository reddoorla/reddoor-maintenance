import { describe, it, expect } from "vitest";
import type { Band, Node } from "../../../src/blux/grid/types.js";
import {
  bandOrCollection,
  bandToCatalog,
} from "../../../src/blux/catalog/classify.js";

// Parser-faithful heading node: html carries NO <hN> wrapper.
const heading = (html: string, level = 2): Node => ({ kind: "heading", level, html });

const band: Band = { index: 3, root: heading("Our Products") };
const feeds = { feed1: { name: "Products" }, feed2: { name: "Mystery Feed" } };

describe("bandOrCollection", () => {
  it("(a) a feed band becomes a BluxCollection query spec, heading preserved", () => {
    const item = {
      sources: ["feed1"],
      sourceConfig: { filters: { tag: "metal" } },
    };
    const spec = bandOrCollection(band, item, feeds, {});
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      index: 3,
      entityType: "product",
      feedIds: ["feed1"],
      filterTag: "metal",
      layout: "grid",
      heading: "<h2>Our Products</h2>",
    });
    // absent config keys are omitted, not set to undefined
    expect(spec).not.toHaveProperty("limit");
    expect(spec).not.toHaveProperty("sort");
    expect(spec).not.toHaveProperty("scrollLoadMore");
    expect(spec).not.toHaveProperty("mediaRatio");
  });

  it("(b) item.type === \"slides\" routes to the carousel layout", () => {
    const spec = bandOrCollection(
      band,
      { type: "slides", sources: ["feed1"], sourceConfig: {} },
      feeds,
      {},
    );
    expect(spec).toMatchObject({ slice: "BluxCollection", layout: "carousel" });
  });

  it("(c) sourceConfig count/sort/mediaRatio/scrollLoadMore ride the spec", () => {
    const spec = bandOrCollection(
      band,
      {
        sources: ["feed2"],
        sourceConfig: {
          count: 8,
          sort: "fdate",
          mediaRatio: "4:3",
          scrollLoadMore: true,
        },
      },
      feeds,
      {},
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      entityType: "collection_item", // unmapped feed name → catch-all
      limit: 8,
      sort: "fdate",
      mediaRatio: "4:3",
      scrollLoadMore: true,
    });
  });

  it("(d) a non-feed item falls through to bandToCatalog unchanged", () => {
    expect(bandOrCollection(band, undefined, feeds, {})).toEqual(
      bandToCatalog(band, {}),
    );
    expect(bandOrCollection(band, { title: "plain block" }, feeds, {})).toEqual(
      bandToCatalog(band, {}),
    );
  });

  it("(e) __media sources are NOT collections — they fall through too", () => {
    const spec = bandOrCollection(
      band,
      { sources: ["__media"], sourceConfig: { filters: { tag: "gallery" } } },
      feeds,
      {},
    );
    expect(spec).toEqual(bandToCatalog(band, {}));
  });
});
