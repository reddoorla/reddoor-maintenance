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

  it("matches singular/plural (Blux stems a trailing s): projects ↔ project", () => {
    // Live resolves `projects&&interior` to 107 tiles — 7 are tagged the
    // SINGULAR `project`; an exact match dropped them.
    const f = tagFilter("projects&&interior");
    expect(f(["project", "interior"])).toBe(true); // singular tag, plural filter
    expect(f(["projects", "interior"])).toBe(true); // plural
    // Conservative: only ONE trailing s, so no unrelated over-match.
    expect(f(["projector", "interior"])).toBe(false);
    expect(f(["project"])).toBe(false); // still needs interior
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
  });

  it("__media: sorts fdate desc and carries the name/description overlay captions", () => {
    // Blux binds the library entry's `name` → tile title and `description` →
    // body overlay (plain text, so ESCAPED); the grid sorts by date desc.
    const media = new Map<string, Record<string, unknown>>([
      ["old", { type: "image/jpeg", tags: ["p"], name: "Older", date: "2020-01-01" }],
      [
        "new",
        {
          type: "image/jpeg",
          tags: ["p"],
          name: "Newer & Bright",
          date: "2025-06-01",
          description: "DESIGN: A\nB",
        },
      ],
    ]);
    const tiles = resolveFeedTiles(
      { sources: ["__media"], sourceConfig: { filters: { tag: "p" }, sort: "fdate" } },
      resolvers({ media }),
    );
    // newest first, and the plain-text name is escaped, description → <p> with <br>
    expect(tiles?.map((t) => t.media?.assetId)).toEqual(["new", "old"]);
    expect(tiles?.[0]?.title).toBe("Newer &amp; Bright");
    expect(tiles?.[0]?.body).toBe("<p>DESIGN: A<br>B</p>");
    // a disabled _title/_body suppresses the caption
    const noCaption = resolveFeedTiles(
      {
        sources: ["__media"],
        sourceConfig: {
          filters: { tag: "p" },
          _title: { class: "disable" },
          _body: { class: "disable" },
        },
      },
      resolvers({ media }),
    );
    expect(noCaption?.every((t) => t.title === undefined && t.body === undefined)).toBe(true);
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

  it("feed: title sort uses localeCompare — matching Blux's own client sort", () => {
    // Blux sorts non-numeric sort-values with `.localeCompare` (verified in the
    // export's sort JS), so we do too — the same V8/ICU collation the browser
    // uses. (A review flagged 'code-point' here; the export's source refutes it.)
    const feeds = new Map([["F", [{ title: "Beta" }, { title: "alpha" }, { title: "Delta" }]]]);
    const tiles = resolveFeedTiles(
      { sources: ["F"], sourceConfig: { sort: "title" } },
      resolvers({ feeds }),
    );
    expect(tiles?.map((t) => t.title)).toEqual(["alpha", "Beta", "Delta"]);
  });

  it("feed: title/body HTML is verbatim — <br> markup kept, entities NOT re-escaped", () => {
    const feeds = new Map([
      ["F", [{ title: "Sheraton Anchorage<br>", body: "<p>x</p>" }, { title: "Surf &amp; Sand" }]],
    ]);
    const tiles = resolveFeedTiles({ sources: ["F"] }, resolvers({ feeds }));
    // the <br> survives (renders a break, not literal text)
    expect(tiles?.[0]?.title).toBe("Sheraton Anchorage<br>");
    // &amp; stays single-encoded (renders "&", not "&amp;")
    expect(tiles?.[1]?.title).toBe("Surf &amp; Sand");
  });

  it("stamps the sourceConfig crop ratio (mediaRatio/ratio) + cover onto every tile image", () => {
    const media = new Map<string, Record<string, unknown>>([
      ["a", { type: "image/jpeg", tags: ["p"] }],
    ]);
    const tiles = resolveFeedTiles(
      { sources: ["__media"], sourceConfig: { filters: { tag: "p" }, mediaRatio: "4:3" } },
      resolvers({ media }),
    );
    expect(tiles?.[0]?.media).toMatchObject({ cropRatio: "4:3", fit: "cover" });
    // feed-record tiles get it too; a malformed ratio is ignored
    const feeds = new Map([["F", [{ title: "T", media: { media: "m1", type: "image/png" } }]]]);
    const framed = resolveFeedTiles(
      { sources: ["F"], sourceConfig: { ratio: "16:9" } },
      resolvers({ feeds }),
    );
    expect(framed?.[0]?.media?.cropRatio).toBe("16:9");
    const noRatio = resolveFeedTiles(
      { sources: ["F"], sourceConfig: { ratio: "bad" } },
      resolvers({ feeds }),
    );
    expect(noRatio?.[0]?.media?.cropRatio).toBeUndefined();
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

  it("places tile title/body html VERBATIM (escaping happened at resolve time)", () => {
    // materializeFeedGrid trusts render-ready html — a feed record's <br> and
    // a resolved __media entity survive; resolveFeedTiles owns the escaping.
    const node = materializeFeedGrid({
      tiles: [{ title: "Anchorage<br>", body: "<p>ok</p>" }],
      columns: 2,
    });
    if (node?.kind !== "row") throw new Error("expected row");
    const tile = node.cells[0]?.node;
    if (tile?.kind !== "stack") throw new Error("expected stack");
    expect(tile.children[0]).toMatchObject({ kind: "heading", html: "Anchorage<br>" });
    expect(tile.children[1]).toMatchObject({ kind: "body", html: "<p>ok</p>" });
  });

  it("builds overlay-card tiles when given an overlay (caption over the image)", () => {
    const node = materializeFeedGrid({
      tiles: [{ media: img("a"), title: "Suite", body: "<p>NYC</p>" }],
      columns: 3,
      overlay: { ratio: "4:3", color: "rgba(1,2,3,0.85)", valign: "top" },
    });
    if (node?.kind !== "row") throw new Error("expected row");
    const tile = node.cells[0]?.node;
    // The tile is a stack carrying the overlay hints, media first then caption.
    expect(tile?.kind).toBe("stack");
    if (tile?.kind !== "stack") return;
    expect(tile.style).toMatchObject({
      _overlay: "4:3",
      _overlayColor: "rgba(1,2,3,0.85)",
      _overlayValign: "top",
    });
    expect(tile.children.map((c) => c.kind)).toEqual(["media", "heading", "body"]);
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
