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

  // Round-2 item 1 — the REAL fitHealthClub band-3 shape (the-pointe/the-tower/
  // media-studios/pinnacle): the band root is a non-empty raw custom-element
  // feed-template mount, the positional item IS aligned. The mount is the Blux
  // placeholder the collection replaces — it must not defeat the emptyish guard.
  it("(i) a pure feed-template mount root does NOT defeat the collection guard (fitHealthClub band 3)", () => {
    const mountBand: Band = {
      index: 3,
      root: {
        kind: "raw",
        html: '<div id="custom-element1" data-exec="custom_a4661bc9_c155_45b9_8339_714febff3fdb"></div>',
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      mountBand,
      {
        // real items[3].sourceConfig (the-pointe)
        sources: ["7051d365-bb42-4329-9e7a-3959e9c9a233"],
        sourceConfig: {
          layout: "behind",
          _body: { class: "disable" },
          _title: { class: "text3" },
          class: "blocks3",
          overlay: true,
          overlayColor: "rgba(63,83,111,0.7)",
          contentvalign: "middle",
        },
      },
      { "7051d365-bb42-4329-9e7a-3959e9c9a233": { name: "The Pointe Equipment Grid" } },
      { diagnostics },
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      index: 3,
      entityType: "product", // equipment-grid suffix rule
      feedIds: ["7051d365-bb42-4329-9e7a-3959e9c9a233"],
    });
    expect(diagnostics).toEqual([]);
  });

  it("(i2) a mount PLUS real content still misaligns", () => {
    const mixedBand: Band = {
      index: 3,
      root: {
        kind: "stack",
        children: [
          {
            kind: "raw",
            html: '<div id="custom-element1" data-exec="custom_a4661bc9_c155_45b9_8339_714febff3fdb"></div>',
          },
          { kind: "media", media: { kind: "image", assetId: "u1" } },
        ],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      mixedBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "feed-band-misalign" });
  });

  it("(i3) a mount whose div carries visible text is content, not a placeholder — still misaligns", () => {
    const visibleMountBand: Band = {
      index: 3,
      root: {
        kind: "raw",
        html: '<div id="custom-element1" data-exec="custom_a4661bc9_c155_45b9_8339_714febff3fdb"><p>Hand-written copy</p></div>',
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      visibleMountBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics[0]).toMatchObject({ kind: "feed-band-misalign" });
  });

  // Round-2 item 2 — Collection is a container (decision B): a MAP mount on a
  // feed band lifts onto the collection spec through the same widget triple
  // BluxSection uses, instead of being treated as content or dropped.
  it("(j) a MAP mount on a feed band lifts onto the collection spec", () => {
    const mapHtml = '<div id="club_map" style="height:600px"></div>';
    const mapConfig = {
      mountId: "club_map",
      mid: "m1",
      layers: [{ name: "l0", lid: "1", initiallyVisible: true, preserveViewport: false }],
      toggles: [],
      styles: {},
    } as unknown as import("../../../src/blux/grid/extract-map.js").MapConfig;
    const mapBand: Band = {
      index: 5,
      root: {
        kind: "stack",
        children: [heading("Find Us"), { kind: "raw", html: mapHtml }],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      mapBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      {
        isMapMount: (n) => n.kind === "raw" && n.html.includes('id="club_map"'),
        mapConfig,
        diagnostics,
      },
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      widgetKind: "map",
      widgetHtml: mapHtml,
      mapConfig,
    });
    expect(diagnostics).toEqual([]);
  });

  // Round-2 item 5 — every source validates, not just [0].
  it("(k) an unknown source in position ≥1 is diagnosed and dropped from feedIds", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["feed1", "ghost"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      entityType: "product",
      feedIds: ["feed1"], // the valid source survives; "ghost" is dropped
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("ghost");
  });

  it("(k2) a DO-NOT-USE source in position ≥1 is diagnosed and dropped too", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["feed1", "dead"], sourceConfig: {} },
      { ...feeds, dead: { name: "DO NOT USE — legacy" } },
      { diagnostics },
    );
    expect(spec).toMatchObject({ slice: "BluxCollection", feedIds: ["feed1"] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("DO NOT USE");
  });

  it("(k3) NO valid source keeps the existing skip behavior (collection kept, each source diagnosed)", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["ghost-a", "ghost-b"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec).toMatchObject({
      slice: "BluxCollection",
      entityType: "collection_item",
      feedIds: ["ghost-a", "ghost-b"],
    });
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.kind === "skipped-feed")).toBe(true);
  });

  it("(k4) __media with extra sources falls through to the grid path but the extras are diagnosed", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["__media", "feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("feed1");
  });

  // Round-2 item 10a — diagnostics are addressable: the page uid rides `where`.
  it("(l) misalign + skipped-feed diagnostics carry the page uid when provided", () => {
    const contentBand: Band = {
      index: 2,
      root: {
        kind: "stack",
        children: [heading("Real Section"), { kind: "body", html: "<p>Real parsed content.</p>" }],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    bandOrCollection(contentBand, { sources: ["feed1"], sourceConfig: {} }, feeds, {
      diagnostics,
      pageUid: "the-pointe",
    });
    expect(diagnostics[0]).toMatchObject({
      kind: "feed-band-misalign",
      where: "the-pointe:2",
    });
    const diagnostics2: import("../../../src/blux/ir.js").Diagnostic[] = [];
    bandOrCollection(band, { sources: ["ghost"], sourceConfig: {} }, feeds, {
      diagnostics: diagnostics2,
      pageUid: "home",
    });
    expect(diagnostics2[0]).toMatchObject({ kind: "skipped-feed", where: "home:3" });
  });

  // Round-3 item 5a — duplicate sources must not duplicate feed ids
  // (feed_ids would emit "feed-1,feed-1").
  it("(m) duplicate sources dedupe: feedIds lists each feed once", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["feed1", "feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec).toMatchObject({ slice: "BluxCollection", feedIds: ["feed1"] });
    expect(diagnostics).toEqual([]);
  });

  // Round-3 item 5b — __media past position 0 is a KNOWN sentinel, not an
  // unknown feed: the diagnostic names it as such; it still leaves feedIds.
  it("(n) __media in a later source position is diagnosed as the sentinel it is, and dropped", () => {
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      band,
      { sources: ["feed1", "__media"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec).toMatchObject({ slice: "BluxCollection", feedIds: ["feed1"] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "skipped-feed" });
    expect(diagnostics[0]!.message).toContain("__media");
    expect(diagnostics[0]!.message).toContain("media-library");
    expect(diagnostics[0]!.message).not.toContain("unknown feed");
  });

  // Round-3 item 5c — the emptyish guard's `ignore` applies through wrapper
  // stacks inside row cells too (probe-verified nesting).
  it("(o) a mount wrapped in a stack inside a row cell is still ignored by the emptyish guard", () => {
    const mount: Node = {
      kind: "raw",
      html: '<div id="custom-element1" data-exec="custom_ab12"></div>',
    };
    const rowBand: Band = {
      index: 3,
      root: {
        kind: "row",
        cells: [
          { token: { cols: 1, raw: "grid-1" }, node: { kind: "stack", children: [mount] } },
        ],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      rowBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).toBe("BluxCollection");
    expect(diagnostics).toEqual([]);
  });

  // Round-3 item 5d — probe-verified mount-guard shapes, locked as repo tests.
  it("(p) a whitespace-only mount is still a placeholder → collection", () => {
    const wsBand: Band = {
      index: 3,
      root: {
        kind: "raw",
        html: '<div id="custom-element1" data-exec="custom_ab12">  \n </div>',
      },
    };
    const spec = bandOrCollection(wsBand, { sources: ["feed1"], sourceConfig: {} }, feeds, {});
    expect(spec.slice).toBe("BluxCollection");
  });

  it("(q) multiple mounts in one band are all placeholders → collection", () => {
    const twoMounts: Band = {
      index: 3,
      root: {
        kind: "stack",
        children: [
          { kind: "raw", html: '<div id="custom-element1" data-exec="custom_ab12"></div>' },
          { kind: "raw", html: '<div id="custom-element2" data-exec="custom_cd34"></div>' },
        ],
      },
    };
    const spec = bandOrCollection(twoMounts, { sources: ["feed1"], sourceConfig: {} }, feeds, {});
    expect(spec.slice).toBe("BluxCollection");
  });

  it("(r) a mount as a DIRECT row-cell node → collection", () => {
    const rowBand: Band = {
      index: 3,
      root: {
        kind: "row",
        cells: [
          {
            token: { cols: 1, raw: "grid-1" },
            node: {
              kind: "raw",
              html: '<div id="custom-element1" data-exec="custom_ab12"></div>',
            },
          },
        ],
      },
    };
    const spec = bandOrCollection(rowBand, { sources: ["feed1"], sourceConfig: {} }, feeds, {});
    expect(spec.slice).toBe("BluxCollection");
  });

  it("(s) a mount containing an <img> is content → misalign", () => {
    const imgBand: Band = {
      index: 3,
      root: {
        kind: "raw",
        html: '<div id="custom-element1" data-exec="custom_ab12"><img src="tile.jpg"></div>',
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      imgBand,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics[0]).toMatchObject({ kind: "feed-band-misalign" });
  });

  it("(t) a mount riding next to visible body text → misalign", () => {
    const mixed: Band = {
      index: 3,
      root: {
        kind: "stack",
        children: [
          { kind: "raw", html: '<div id="custom-element1" data-exec="custom_ab12"></div>' },
          { kind: "body", html: "<p>Hand-written copy</p>" },
        ],
      },
    };
    const diagnostics: import("../../../src/blux/ir.js").Diagnostic[] = [];
    const spec = bandOrCollection(
      mixed,
      { sources: ["feed1"], sourceConfig: {} },
      feeds,
      { diagnostics },
    );
    expect(spec.slice).not.toBe("BluxCollection");
    expect(diagnostics[0]).toMatchObject({ kind: "feed-band-misalign" });
  });
});
