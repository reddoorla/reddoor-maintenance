import { describe, it, expect } from "vitest";
import type { Band, Cell, Node, Media } from "../../../src/blux/grid/types.js";
// Direct module import, mirroring the skeleton's classify.test.ts pattern.
import { bandToCatalog } from "../../../src/blux/catalog/classify.js";
import { catalogSpecToPlanSlice } from "../../../src/blux/catalog/emit.js";
import type { CatalogCell } from "../../../src/blux/catalog/spec.js";

const img = (id: string): Media => ({ kind: "image", assetId: id });
const vid = (id: string): Media => ({
  kind: "video",
  assetId: id,
  base: "https://cdn/",
  ext: "mp4",
});
// Parser-faithful: `heading.html` carries NO <hN> wrapper (parse-grid emits
// the inner html only) — the catalog layer wraps it.
const heading = (html: string, level = 3): Node => ({ kind: "heading", level, html });
const body = (html: string): Node => ({ kind: "body", html });
const media = (m: Media): Node => ({ kind: "media", media: m });
const cell = (node: Node, cols: number | "any" = 1): Cell => ({
  token: { cols, raw: typeof cols === "number" ? `grid-${cols}` : "grid" },
  node,
});
const row = (nodes: Node[]): Node => ({ kind: "row", cells: nodes.map((n) => cell(n)) });
const stack = (children: Node[]): Node => ({ kind: "stack", children });

const cellMediaIds = (cells: CatalogCell[]): string[] => {
  const ids: string[] = [];
  const walk = (cs: CatalogCell[]): void => {
    for (const c of cs) {
      if (c.media) ids.push(c.media.assetId);
      if (c.subgrid) walk(c.subgrid);
    }
  };
  walk(cells);
  return ids;
};

describe("bandToCatalog (breadth)", () => {
  it("routes a 2-cell media+text row to BluxMediaText carrying media + title + body", () => {
    const band: Band = {
      index: 1,
      root: row([media(img("m1")), stack([heading("Villa"), body("<p>desc</p>")])]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxMediaText");
    if (spec.slice !== "BluxMediaText") return;
    expect(spec.media.assetId).toBe("m1");
    expect(spec.mediaSide).toBe("left");
    expect(spec.title).toBe("<h3>Villa</h3>");
    expect(spec.body).toContain("desc");
    expect(spec.index).toBe(1);
  });

  it("refuses BluxMediaText when the text half carries media of its own (review #5)", () => {
    // Band 1 of the-pointe: the text half is a stack that ALSO holds images.
    // The thin BluxMediaText spec can't carry them — the whole band must go
    // through the grid path so nothing is lost.
    const band: Band = {
      index: 1,
      root: row([
        media(img("m1")),
        stack([heading("Villa"), body("<p>desc</p>"), media(img("m2"))]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).not.toBe("BluxMediaText");
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(cellMediaIds(spec.cells).sort()).toEqual(["m1", "m2"]);
  });

  it("keeps EVERY text-side media via a depth-0 subgrid split (gap 3a — band 1 shape)", () => {
    // Band 1 of the-pointe: the text half holds TWO images besides its text.
    // The refused-BluxMediaText grid path must not truncate to the first —
    // the cell splits into a subgrid of one text item + one item per media.
    const band: Band = {
      index: 1,
      root: row([
        media(img("m1")),
        stack([heading("Villa"), body("<p>desc</p>"), media(img("m2")), media(img("m3"))]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(cellMediaIds(spec.cells).sort()).toEqual(["m1", "m2", "m3"]);
    const split = spec.cells.find((c) => c.kind === "subgrid");
    expect(JSON.stringify(split)).toContain("Villa");
  });

  it("routes a [video | text] split band away from BluxMediaText — the video rides an embed (gap 4a)", () => {
    // A video cannot ride BluxMediaText's Image field (the {__asset_id}
    // marker would dangle: videos are excluded from image uploads). The band
    // must go through the grid path, where the video becomes an embed cell.
    const band: Band = {
      index: 13,
      root: row([media(vid("v1")), stack([heading("Tour"), body("<p>watch the film</p>")])]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).not.toBe("BluxMediaText");
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).not.toBe("blux_media_text");
    expect(JSON.stringify(slice)).toContain("<video");
    expect(JSON.stringify(slice)).toContain("https://cdn/v1.mp4");
  });

  it("folds a later heading into the body without swallowing the following bare text (gap 1, through emit)", () => {
    const band: Band = {
      index: 12,
      root: row([
        stack([
          heading("The Pointe", 3),
          heading("a monument of excellence", 4),
          body("Nestled among the hills"),
        ]),
      ]),
    };
    const slice = catalogSpecToPlanSlice(bandToCatalog(band));
    // Dig out every emitted html, wherever the routing put it: rich-text
    // markers AND the baked `body_html` plain strings (approach B — folded
    // cell bodies ride a plain Text string, not a `__richtext_html` marker).
    const htmls: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const r = v as Record<string, unknown>;
        if (typeof r.__richtext_html === "string") htmls.push(r.__richtext_html);
        if (typeof r.body_html === "string") htmls.push(r.body_html);
        Object.values(r).forEach(walk);
      }
    };
    walk(slice.primary);
    const folded = htmls.find((h) => h.includes("</h4>"));
    expect(folded).toContain("</h4>\n<p>Nestled among the hills</p>");
  });

  it("routes a pure-media row to BluxGallery with one media cell per image", () => {
    const band: Band = {
      index: 2,
      root: row([media(img("g1")), media(img("g2")), media(img("g3"))]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGallery");
    if (spec.slice !== "BluxGallery") return;
    expect(spec.cells).toHaveLength(3);
    expect(spec.cells.every((c) => c.kind === "media")).toBe(true);
    expect(spec.cells.map((c) => c.media?.assetId)).toEqual(["g1", "g2", "g3"]);
  });

  it("routes a single-media band to BluxMedia", () => {
    const band: Band = { index: 3, root: media(img("solo")) };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxMedia");
    if (spec.slice !== "BluxMedia") return;
    expect(spec.media.assetId).toBe("solo");
  });

  it("routes a heading-only band to BluxSection without duplicating the heading as a cell", () => {
    const band: Band = { index: 4, root: heading("About Us", 2) };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxSection");
    if (spec.slice !== "BluxSection") return;
    expect(spec.heading).toBe("<h2>About Us</h2>");
    expect(spec.cells).toHaveLength(0);
  });

  it("routes a shallow Grid band to BluxGrid, splitting the section heading out", () => {
    const band: Band = {
      index: 6,
      root: stack([
        heading("Features", 2),
        row([
          stack([heading("a", 4), body("<p>x</p>")]),
          stack([heading("b", 4), body("<p>y</p>")]),
          media(img("f1")),
        ]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(spec.heading).toContain("Features");
    expect(spec.cells.length).toBeGreaterThan(0);
    expect(JSON.stringify(spec.cells)).toContain("f1");
  });

  it("populates BluxGrid.columns from the top row's grid token (review #7)", () => {
    const band: Band = {
      index: 6,
      root: {
        kind: "row",
        cells: [
          cell(stack([heading("a", 4), body("<p>x</p>")]), 3),
          cell(stack([heading("b", 4), body("<p>y</p>")]), 3),
          cell(media(img("f1")), 3),
        ],
      },
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(spec.columns).toBe(3);
  });

  it('falls back to the cell count for columns when the token cols is "any"', () => {
    const band: Band = {
      index: 6,
      root: {
        kind: "row",
        cells: [
          cell(stack([heading("a", 4), body("<p>x</p>")]), "any"),
          cell(stack([heading("b", 4), body("<p>y</p>")]), "any"),
        ],
      },
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(spec.columns).toBe(2);
  });

  it("carries a carousel slide's caption AND subcaption (review #6)", () => {
    const slide = (id: string, title?: string, sub?: string): Node =>
      stack([media(img(id)), ...(title ? [heading(title, 5)] : []), ...(sub ? [body(sub)] : [])]);
    const band: Band = {
      index: 9,
      root: {
        kind: "row",
        slider: { columns: 1 },
        cells: [cell(slide("s1", "Tower", "<p>Los Angeles</p>")), cell(slide("s2", "Pointe"))],
      },
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxCarousel");
    if (spec.slice !== "BluxCarousel") return;
    expect(spec.cells[0]?.title).toBe("<h5>Tower</h5>");
    expect(spec.cells[0]?.bodyHtml).toContain("Los Angeles");
    expect(spec.cells[1]?.title).toBe("<h5>Pointe</h5>");
    expect(spec.cells[1]?.bodyHtml).toBeUndefined();
  });

  it("routes a band nesting rows past cell→subgrid depth to BluxBlock, preserving buried media", () => {
    // Three row levels (row → subgrid cell → another row) — past what the
    // Prismic cell→subgrid model can render, so content survives via the
    // serialized fallback.
    const band: Band = {
      index: 5,
      root: row([stack([row([row([media(img("d1")), media(img("d2"))])])])]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxBlock");
    if (spec.slice !== "BluxBlock") return;
    const flat = JSON.stringify(spec.payload);
    expect(flat).toContain("d1");
    expect(flat).toContain("d2");
  });

  it("routes a stack-buried nested row at subgrid depth to BluxBlock (gap 3b — band 10 shape)", () => {
    // Band 10 of the-pointe: a subgrid ITEM is a stack[h4, row[2 media]] —
    // the nested row hides inside a multi-child stack, so the old direct-row
    // check missed it and one media was silently dropped while the guard
    // said legal. The honest guard routes the content-preserving fallback.
    const band: Band = {
      index: 10,
      root: row([
        media(img("v0")),
        row([stack([heading("Amenities", 4), row([media(img("a1")), media(img("a2"))])])]),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxBlock");
    if (spec.slice !== "BluxBlock") return;
    const flat = JSON.stringify(spec.payload);
    expect(flat).toContain("a1");
    expect(flat).toContain("a2");
    expect(flat).toContain("Amenities");
    expect(spec.media.map((m) => m.assetId)).toEqual(expect.arrayContaining(["v0", "a1", "a2"]));
  });

  it("routes a multi-child stack root whose child rows nest rows to BluxBlock (review #2)", () => {
    // nodeToCells maps the stack's children straight to cells, so a child row
    // is already a subgrid — a row nested in ITS cells cannot be stored. The
    // guard must agree with the emission and route the fallback.
    const band: Band = {
      index: 7,
      root: stack([
        heading("Deep", 2),
        row([row([media(img("n1")), media(img("n2"))]), body("<p>x</p>")]),
        body("<p>tail</p>"),
      ]),
    };
    const spec = bandToCatalog(band);
    expect(spec.slice).toBe("BluxBlock");
    if (spec.slice !== "BluxBlock") return;
    const flat = JSON.stringify(spec.payload);
    expect(flat).toContain("n1");
    expect(flat).toContain("n2");
    expect(flat).toContain("tail");
  });
});
