import { describe, it, expect } from "vitest";
import type {
  BluxBlockSpec,
  BluxCarouselSpec,
  BluxGallerySpec,
  BluxGridSpec,
  BluxMediaSpec,
  BluxMediaTextSpec,
} from "../../../src/blux/catalog/index.js";
import { buildCatalogPlan, catalogSpecToPlanSlice } from "../../../src/blux/catalog/index.js";
import type { Media } from "../../../src/blux/grid/types.js";

const img = (id: string): Media => ({
  kind: "image",
  assetId: id,
  base: "https://cdn/",
  ext: "jpg",
});
const vid = (id: string): Media => ({
  kind: "video",
  assetId: id,
  base: "https://cdn/",
  ext: "mp4",
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
      media: [],
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

  it("a video cell → embed_html <video>, never an Image-field marker (review #8)", () => {
    const spec: BluxGridSpec = {
      slice: "BluxGrid",
      index: 7,
      cells: [{ kind: "media", media: vid("v9") }],
    };
    const slice = catalogSpecToPlanSlice(spec);
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells[0]?.media).toBeUndefined();
    expect(cells[0]?.embed_html).toContain("<video");
    expect(cells[0]?.embed_html).toContain("https://cdn/v9.mp4");
  });

  it("a BluxMedia video spec → video_embed populated, no media asset marker (review #8)", () => {
    const spec: BluxMediaSpec = { slice: "BluxMedia", index: 8, media: vid("v1") };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.primary.media).toBeUndefined();
    expect(slice.primary.video_embed).toContain("<video");
    expect(slice.primary.video_embed).toContain("https://cdn/v1.mp4");
  });

  it("emits the band background for BluxMediaText (review #9)", () => {
    const spec: BluxMediaTextSpec = {
      slice: "BluxMediaText",
      index: 9,
      mediaSide: "left",
      media: img("m1"),
      background: img("bg1"),
      backgroundColor: "#111",
    };
    const p = catalogSpecToPlanSlice(spec).primary;
    expect(p.background_image).toEqual({ __asset_id: "bg1" });
    expect(p.background_color).toBe("#111");
  });

  it("emits the band background for BluxMedia (review #9)", () => {
    const spec: BluxMediaSpec = {
      slice: "BluxMedia",
      index: 10,
      media: img("m1"),
      background: img("bg1"),
      backgroundColor: "#222",
    };
    const p = catalogSpecToPlanSlice(spec).primary;
    expect(p.background_image).toEqual({ __asset_id: "bg1" });
    expect(p.background_color).toBe("#222");
  });

  it("BluxBlock background rides ONLY the payload wrapper, in kebab-case (gap 5)", () => {
    // The starter's blux_block model has no background fields (unknown primary
    // fields risk Migration API rejection), and its styleString emits style
    // keys verbatim — camelCase parses to zero CSS declarations.
    const spec: BluxBlockSpec = {
      slice: "BluxBlock",
      index: 11,
      background: img("bg2"),
      backgroundColor: "#333",
      media: [],
      payload: { tag: "div", html: "x" },
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(Object.keys(slice.primary)).toEqual(["payload"]);
    expect(slice.primary.payload as string).toContain('"background-image"');
    const payload = JSON.parse(slice.primary.payload as string) as {
      tag: string;
      style: Record<string, string>;
      children: unknown[];
    };
    expect(payload.style["background-image"]).toBe("url(https://cdn/bg2.jpg)");
    expect(payload.style["background-color"]).toBe("#333");
    expect(payload.children[0]).toEqual({ tag: "div", html: "x" });
  });

  it("a background-less BluxBlock emits the payload unwrapped, primary payload-only (gap 5)", () => {
    const spec: BluxBlockSpec = {
      slice: "BluxBlock",
      index: 12,
      media: [],
      payload: { tag: "div", html: "y" },
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(Object.keys(slice.primary)).toEqual(["payload"]);
    expect(JSON.parse(slice.primary.payload as string)).toEqual({
      tag: "div",
      html: "y",
    });
  });
});

describe("catalogSpecToPlanSlice — heading levels clamp to the target field's model (gap 2)", () => {
  it("clamps a cell title to h3–h4: an h1 emits <h3>", () => {
    const spec: BluxGridSpec = {
      slice: "BluxGrid",
      index: 0,
      cells: [{ kind: "text", title: "<h1>Big</h1>", body: "<p>x</p>" }],
    };
    const cells = catalogSpecToPlanSlice(spec).primary.cells as Record<string, unknown>[];
    expect(cells[0]?.title).toEqual({ __richtext_html: "<h3>Big</h3>" });
  });
  it("clamps a carousel caption to h3–h4: an h5 emits <h4>", () => {
    const spec: BluxCarouselSpec = {
      slice: "BluxCarousel",
      index: 1,
      cells: [{ kind: "media", media: img("c1"), title: "<h5>Tower</h5>" }],
    };
    const cells = catalogSpecToPlanSlice(spec).primary.cells as Record<string, unknown>[];
    expect(cells[0]?.title).toEqual({ __richtext_html: "<h4>Tower</h4>" });
  });
  it("clamps a section/grid heading to h2–h3", () => {
    const h1: BluxGridSpec = { slice: "BluxGrid", index: 2, heading: "<h1>Top</h1>", cells: [] };
    const h4: BluxGridSpec = { slice: "BluxGrid", index: 3, heading: "<h4>Low</h4>", cells: [] };
    expect(catalogSpecToPlanSlice(h1).primary.heading).toEqual({
      __richtext_html: "<h2>Top</h2>",
    });
    expect(catalogSpecToPlanSlice(h4).primary.heading).toEqual({
      __richtext_html: "<h3>Low</h3>",
    });
  });
  it("keeps in-window levels and non-heading titles untouched", () => {
    const spec: BluxGridSpec = {
      slice: "BluxGrid",
      index: 4,
      heading: "<h2>Fine</h2>",
      cells: [{ kind: "media", media: img("p1"), title: "<p>plain caption</p>" }],
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.primary.heading).toEqual({ __richtext_html: "<h2>Fine</h2>" });
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells[0]?.title).toEqual({ __richtext_html: "<p>plain caption</p>" });
  });
});

describe("videoTag honors Media.playback (gap 6)", () => {
  it("emits autoplay/loop as muted playsinline (browser autoplay policy), no controls", () => {
    const spec: BluxMediaSpec = {
      slice: "BluxMedia",
      index: 0,
      media: { ...vid("v1"), playback: { autoplay: true, loop: true } },
    };
    const embed = catalogSpecToPlanSlice(spec).primary.video_embed as string;
    expect(embed).toContain("<video autoplay loop muted playsinline");
    expect(embed).not.toContain("controls");
  });
  it("defaults to a user-initiated inline video when playback is absent", () => {
    const spec: BluxMediaSpec = { slice: "BluxMedia", index: 1, media: vid("v2") };
    const embed = catalogSpecToPlanSlice(spec).primary.video_embed as string;
    expect(embed).toContain("<video controls playsinline");
    expect(embed).not.toContain("autoplay");
  });
  it("mirrors explicit controls/playsinline attributes as-is", () => {
    const spec: BluxMediaSpec = {
      slice: "BluxMedia",
      index: 2,
      media: { ...vid("v3"), playback: { controls: true, playsinline: true } },
    };
    const embed = catalogSpecToPlanSlice(spec).primary.video_embed as string;
    expect(embed).toContain("<video controls playsinline");
    expect(embed).not.toContain("muted");
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
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    const ids = plan.assets.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["a1", "a2", "a3", "a4", "a5"]));
  });

  it("collects a BluxBlock spec's media so the payload's assets upload (review #10)", () => {
    const specs = [
      {
        slice: "BluxBlock",
        index: 0,
        media: [img("b1"), img("b2")],
        payload: { tag: "div", children: [] },
      } satisfies BluxBlockSpec,
    ];
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    expect(plan.assets.map((a) => a.id)).toEqual(expect.arrayContaining(["b1", "b2"]));
  });

  it("includes video assets so they migrate off the Blux CDN (CDN sunset)", () => {
    // The Blux CDN is being shut down — every referenced asset, videos included,
    // must land in Prismic. Videos upload like images; the emitted <video src>
    // (a CDN url in video_embed/embed_html) is then swapped to the Prismic url
    // by the migrate-time rewriteDocUrls, keyed on the same mediaCdnUrl string.
    const specs = [
      { slice: "BluxMedia", index: 0, media: vid("v1") } satisfies BluxMediaSpec,
      {
        slice: "BluxGrid",
        index: 1,
        cells: [{ kind: "media", media: vid("v2") }],
      } satisfies BluxGridSpec,
    ];
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    expect(plan.assets.map((a) => a.id)).toEqual(expect.arrayContaining(["v1", "v2"]));
    // the upload url is the same CDN string the <video src> carries, so the
    // migrate-time rewrite finds and swaps it
    expect(plan.assets.find((a) => a.id === "v1")?.url).toBe("https://cdn/v1.mp4");
  });

  // CDN-sunset backstop: a Blux-CDN url can ride a document as a RAW STRING that
  // no media marker captured — an embed_html <a href> to a PDF/file. specMedia
  // only walks markers, so buildCatalogPlan scans the built documents and
  // registers each unregistered CDN url as its own asset, off the retiring CDN.
  it("backstop-registers a Blux-CDN file asset baked as a raw embed_html href (PDF button)", () => {
    const PDF = "https://dv4tl7yyk1zlp.cloudfront.net/site-1/1b5b96c1-16fb-4d8b.pdf";
    const specs = [
      {
        slice: "BluxGrid",
        index: 0,
        cells: [{ kind: "embed", embedHtml: `<a href="${PDF}">Burbank Incentives</a>` }],
      } satisfies BluxGridSpec,
    ];
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    const pdf = plan.assets.find((a) => a.url === PDF);
    expect(pdf).toBeDefined();
    expect(pdf!.id).toBe("1b5b96c1-16fb-4d8b"); // id = the Blux filename stem
  });

  it("does NOT double-register an image already collected — payload url equals the plan.asset url", () => {
    // A BluxBlock background rides BOTH plan.assets (specMedia) AND the payload's
    // `background-image:url(...)` as a raw string. mediaCdnUrl (payload) equals
    // mediaUrl (plan.asset) when a base is present, so the backstop dedups it.
    const bg: Media = {
      kind: "image",
      assetId: "bg1",
      base: "https://d3syaxnfm3oj0e.cloudfront.net/site-1/",
      ext: "jpg",
    };
    const specs = [
      {
        slice: "BluxBlock",
        index: 0,
        background: bg,
        media: [bg],
        payload: { tag: "div", children: [] },
      } satisfies BluxBlockSpec,
    ];
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    const url = "https://d3syaxnfm3oj0e.cloudfront.net/site-1/bg1.jpg";
    expect(JSON.stringify(plan.documents)).toContain(url); // the raw url IS in the doc
    expect(plan.assets.filter((a) => a.url === url)).toHaveLength(1); // registered exactly once
  });

  it("does NOT adopt an over-captured CDN string with no clean file extension (avoids a 404 abort)", () => {
    // A BARE url ending a sentence captures the trailing '.'; that string is not a
    // fetchable asset, so it must NOT become a plan.asset (registering it would
    // 404 and abort the whole migrate). It is left for the rewrite to flag.
    const bare = "https://dv4tl7yyk1zlp.cloudfront.net/site-1/deadbeef01.pdf";
    const specs = [
      {
        slice: "BluxGrid",
        index: 0,
        cells: [{ kind: "embed", embedHtml: `<p>Full details at ${bare}. Enjoy.</p>` }],
      } satisfies BluxGridSpec,
    ];
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs }], {
      assets: [],
      diagnostics: [],
    });
    // the captured url carries the trailing '.', which has no clean extension → dropped
    expect(plan.assets.some((a) => a.url.includes("deadbeef01"))).toBe(false);
  });
});
