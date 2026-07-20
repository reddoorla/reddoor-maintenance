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

  it("(c) sourceConfig limit/sort/mediaRatio/scrollLoadMore ride the spec", () => {
    // Real Blux sourceConfig carries `limit` as a STRING ('9','12','20','0').
    const spec = bandOrCollection(
      band,
      {
        sources: ["feed2"],
        sourceConfig: {
          limit: "9",
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
      limit: 9,
      sort: "fdate",
      mediaRatio: "4:3",
      scrollLoadMore: true,
    });
  });

  it("(c2) limit '0' means unlimited — omitted, like an absent/NaN limit", () => {
    const at = (sourceConfig: Record<string, unknown>) =>
      bandOrCollection(band, { sources: ["feed1"], sourceConfig }, feeds, {});
    expect(at({ limit: "0" })).not.toHaveProperty("limit");
    expect(at({ limit: 0 })).not.toHaveProperty("limit");
    expect(at({ limit: "many" })).not.toHaveProperty("limit");
    // `count` never occurs in the fleet — it is not the limit key
    expect(at({ count: 8 })).not.toHaveProperty("limit");
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

  it("(f) a CONTENT-BEARING band with a feed item is a positional misalignment — classified as content + diagnostic", () => {
    const contentBand: Band = {
      index: 2,
      root: {
        kind: "stack",
        children: [heading("Real Section"), { kind: "body", html: "<p>Real parsed content.</p>" }],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const opts = { diagnostics };
    const spec = bandOrCollection(
      contentBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      opts,
    );
    expect(spec).toEqual(bandToCatalog(contentBand, opts));
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "feed-band-misalign" });
    expect(diagnostics[0]!.message).toContain("band 2");
  });

  it("(f2) an emptyish band (heading only) with a feed item IS a collection — no misalign diagnostic", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).toBe("BluxCollection");
    expect(diagnostics).toHaveLength(0);
  });

  it("(g) an unknown feed source still classifies but is diagnosed, never silent", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["ghost-feed"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      entityType: "collection_item",
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("ghost-feed");
  });

  it("(h) a DO-NOT-USE feed source is diagnosed too", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["dead"], sourceConfig: {} },
      { dead: { name: "DO NOT USE — legacy" } },
      { diagnostics },
    );
    expect(spec.slice).toBe("BluxCollection");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("DO NOT USE");
  });
});
