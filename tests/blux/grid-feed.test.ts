import { describe, expect, it } from "vitest";
import {
  tagFilter,
  resolveFeedTiles,
  materializeFeedGrid,
  buildFeedResolvers,
  feedAssetBase,
  type FeedResolvers,
} from "../../src/blux/grid/feed-grid.js";
import type { Media } from "../../src/blux/grid/types.js";

const img = (uuid: string): Media => ({
  kind: "image",
  assetId: uuid,
  base: "https://cdn/s/",
  ext: "jpg",
});

const resolvers = (over: Partial<FeedResolvers> = {}): FeedResolvers => ({
  feeds: new Map(),
  media: new Map(),
  mediaFor: (uuid) => img(uuid),
  ...over,
});

describe("tagFilter", () => {
  it("&& = AND: all terms must be present", () => {
    const f = tagFilter("projects&&interior");
    expect(f(["projects", "interior", "extra"])).toBe(true);
    expect(f(["projects"])).toBe(false);
    expect(f(["interior"])).toBe(false);
  });

  it("|| = OR of AND-groups; ignores empty/leading terms; case-insensitive", () => {
    const f = tagFilter("case||&&metal&&sofa");
    expect(f(["case"])).toBe(true); // first group (single term)
    expect(f(["Metal", "Sofa"])).toBe(true); // second group, leading && ignored, case-insensitive
    expect(f(["metal"])).toBe(false); // second group needs BOTH
    expect(f(["chair"])).toBe(false);
  });

  it("empty/absent expression matches everything", () => {
    expect(tagFilter(undefined)(["x"])).toBe(true);
    expect(tagFilter("")([])).toBe(true);
  });
});

describe("resolveFeedTiles", () => {
  it("__media: image tiles for every tag-matched library image, non-images skipped", () => {
    const media = new Map<string, Record<string, unknown>>([
      ["a", { type: "image/jpeg", tags: ["projects", "interior"] }],
      ["b", { type: "image/png", tags: ["projects", "interior"] }],
      ["c", { type: "image/jpeg", tags: ["projects", "exterior"] }], // wrong tag
      ["d", { type: "application/pdf", tags: ["projects", "interior"] }], // not an image
    ]);
    const tiles = resolveFeedTiles(
      { sources: ["__media"], sourceConfig: { filters: { tag: "projects&&interior" } } },
      resolvers({ media }),
    );
    expect(tiles?.map((t) => t.media?.assetId)).toEqual(["a", "b"]);
    expect(tiles?.every((t) => t.title === undefined)).toBe(true);
  });

  it("feed: filtered + sorted records → tiles; disabled records and disabled fields dropped", () => {
    const feeds = new Map([
      [
        "F",
        [
          { title: "Beta", body: "<p>b</p>", tags: ["show"] },
          { title: "Alpha", body: "<p>a</p>", tags: ["show"] },
          { title: "Hidden", tags: ["show"], disabled: true },
          { title: "Other", tags: ["skip"] },
        ],
      ],
    ]);
    const tiles = resolveFeedTiles(
      {
        sources: ["F"],
        sourceConfig: { filters: { tag: "show" }, sort: "title", _body: { class: "disable" } },
      },
      resolvers({ feeds }),
    );
    // sorted by title, tag-filtered, disabled record removed, body suppressed
    expect(tiles?.map((t) => t.title)).toEqual(["Alpha", "Beta"]);
    expect(tiles?.every((t) => t.body === undefined)).toBe(true);
  });

  it("feed: a record's own media rides onto its tile", () => {
    const feeds = new Map([
      ["F", [{ title: "Chair", media: { media: "m1", type: "image/jpeg" } }]],
    ]);
    const tiles = resolveFeedTiles({ sources: ["F"] }, resolvers({ feeds }));
    expect(tiles?.[0]).toMatchObject({ title: "Chair", media: { assetId: "m1" } });
  });

  it("returns null for an unknown source or no sources", () => {
    expect(resolveFeedTiles({ sources: ["ghost"] }, resolvers())).toBeNull();
    expect(resolveFeedTiles({ sources: [] }, resolvers())).toBeNull();
  });
});

describe("feedAssetBase + buildFeedResolvers (review hardening)", () => {
  it("scrapes the export's real CDN host from data-base, normalizing http→https", () => {
    const html =
      '<div class="camediaload" data-base="http://second-host.cloudfront.net/site-9/"></div>';
    expect(feedAssetBase([html], "site-9")).toBe("https://second-host.cloudfront.net/site-9/");
  });

  it("falls back to the first known host + siteId when no data-base is present", () => {
    expect(feedAssetBase(["<div></div>"], "site-9")).toContain("/site-9/");
  });

  it("mediaFor derives the ext from the filename when the mime is unmapped, dropping non-images", () => {
    const r = buildFeedResolvers({}, {}, "https://cdn/s/");
    // unmapped mime → filename ext
    expect(r.mediaFor("u", "custom", "photo.HEIC ")).toBeNull(); // heic isn't an image ext we serve
    expect(r.mediaFor("u", "application/octet-stream", "shot.jpeg")).toMatchObject({ ext: "jpg" });
    expect(r.mediaFor("u", "image/avif", undefined)).toMatchObject({ ext: "avif" });
    // no mime, no image filename → dropped
    expect(r.mediaFor("u", undefined, "notes.txt")).toBeNull();
  });
});

describe("materializeFeedGrid", () => {
  it("builds heading over a row of tile cells at the source column count", () => {
    const node = materializeFeedGrid({
      heading: { html: "Interior", level: 2, role: "text2" },
      tiles: [{ media: img("a") }, { media: img("b"), title: "Suite" }],
      columns: 3,
      spacing: 10,
    });
    expect(node?.kind).toBe("stack");
    if (node?.kind !== "stack") return;
    expect(node.children[0]).toMatchObject({ kind: "heading", html: "Interior" });
    const row = node.children[1];
    expect(row?.kind).toBe("row");
    if (row?.kind !== "row") return;
    expect(row.cells).toHaveLength(2);
    expect(row.cells[0]?.token).toMatchObject({ cols: 3, spacing: 10 });
    // bare image tile stays a media node; image+title tile becomes a stack
    expect(row.cells[0]?.node.kind).toBe("media");
    expect(row.cells[1]?.node.kind).toBe("stack");
  });

  it("escapes plain-text feed titles into the heading html", () => {
    const node = materializeFeedGrid({
      tiles: [{ title: "Smith & Co <Ltd>" }],
      columns: 2,
    });
    if (node?.kind !== "row") throw new Error("expected row");
    const tile = node.cells[0]?.node;
    expect(tile).toMatchObject({ kind: "heading", html: "Smith &amp; Co &lt;Ltd&gt;" });
  });

  it("returns the heading alone with no tiles, null with neither", () => {
    expect(
      materializeFeedGrid({ heading: { html: "H", level: 2 }, tiles: null, columns: 3 }),
    ).toMatchObject({
      kind: "heading",
    });
    expect(materializeFeedGrid({ tiles: [], columns: 3 })).toBeNull();
  });
});
