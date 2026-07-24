import { describe, it, expect } from "vitest";
import type { Node, Media } from "../../../src/blux/grid/types.js";
import type { CatalogCell } from "../../../src/blux/catalog/spec.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "../../../src/blux/catalog/cells.js";

const img = (id: string): Media => ({ kind: "image", assetId: id });
const vid = (id: string): Media => ({
  kind: "video",
  assetId: id,
  base: "https://cdn/",
  ext: "mp4",
});
// Parser-faithful: `heading.html` carries NO <hN> wrapper (parse-grid emits the
// inner html only) — the catalog layer is responsible for wrapping.
const heading = (html: string, level = 3): Node => ({ kind: "heading", level, html });
const body = (html: string): Node => ({ kind: "body", html });
const media = (m: Media): Node => ({ kind: "media", media: m });
const raw = (html: string): Node => ({ kind: "raw", html });
const cell = (node: Node) => ({ token: { cols: 1, raw: "grid-1" }, node });
const row = (nodes: Node[]): Node => ({ kind: "row", cells: nodes.map(cell) });
const stack = (children: Node[]): Node => ({ kind: "stack", children });

describe("cellFromNode", () => {
  it("captures media + heading + body co-located in a sub-stack (skeleton dropped these)", () => {
    const c = cellFromNode(stack([heading("The Pointe"), media(img("u1")), body("<p>x</p>")]));
    expect(c.media?.assetId).toBe("u1");
    expect(c.title).toContain("The Pointe");
    expect(c.bodyHtml).toContain("x");
  });
  it("turns a nested row into a subgrid (one level)", () => {
    const c = cellFromNode(row([media(img("a")), media(img("b"))]));
    expect(c.kind).toBe("subgrid");
    expect(c.subgrid).toHaveLength(2);
    expect(c.subgrid?.[0]?.media?.assetId).toBe("a");
  });
  it("classifies a bare media node as a media cell", () => {
    expect(cellFromNode(media(img("z"))).kind).toBe("media");
  });
});

describe("cellFromNode — every heading survives (review #1)", () => {
  it("keeps the first heading as title and folds later headings into the body in document order", () => {
    const c = cellFromNode(
      stack([heading("Alpha"), body("<p>one</p>"), heading("Beta", 4), body("<p>two</p>")]),
    );
    expect(c.title).toBe("<h3>Alpha</h3>");
    const b = c.bodyHtml ?? "";
    const iOne = b.indexOf("<p>one</p>");
    const iBeta = b.indexOf("<h4>Beta</h4>");
    const iTwo = b.indexOf("<p>two</p>");
    expect(iOne).toBeGreaterThanOrEqual(0);
    expect(iBeta).toBeGreaterThan(iOne);
    expect(iTwo).toBeGreaterThan(iBeta);
  });
});

describe("cellFromNode — headings emit wrapped html (review #3)", () => {
  it("wraps the title in the heading node's own <hN> tag", () => {
    const c = cellFromNode(stack([heading("Suites", 5), body("<p>x</p>")]));
    expect(c.title).toBe("<h5>Suites</h5>");
  });
});

describe("cellFromNode — raw html capture (review #4)", () => {
  it("captures non-empty raw html into embedHtml alongside text (kind stays text)", () => {
    const c = cellFromNode(stack([body("<p>x</p>"), raw('<a class="button">Visit Website</a>')]));
    expect(c.kind).toBe("text");
    expect(c.embedHtml).toContain("Visit Website");
  });
  it("a raw-only cell becomes an embed cell (not an empty text cell)", () => {
    const c = cellFromNode(raw('<a class="button">Visit Website</a>'));
    expect(c.kind).toBe("embed");
    expect(c.embedHtml).toContain("Visit Website");
  });
  it("ignores empty raws (client-mount shells)", () => {
    const c = cellFromNode(stack([body("<p>x</p>"), raw('<div class="mount"> </div>')]));
    expect(c.embedHtml).toBeUndefined();
  });
});

describe("cellFromNode — bare body parts are <p>-wrapped (gap 1)", () => {
  it("wraps untagged body html in <p> so a folded heading cannot swallow it", () => {
    const c = cellFromNode(
      stack([
        heading("The Pointe"),
        heading("a monument of excellence", 4),
        body("Nestled among the hills"),
      ]),
    );
    expect(c.title).toBe("<h3>The Pointe</h3>");
    expect(c.bodyHtml).toBe("<h4>a monument of excellence</h4>\n<p>Nestled among the hills</p>");
  });
  it("leaves already-tagged body html untouched", () => {
    const c = cellFromNode(stack([heading("T"), body("<p>tagged</p>")]));
    expect(c.bodyHtml).toBe("<p>tagged</p>");
  });
});

describe("cellFromNode — each folded body block keeps its own role (approach B)", () => {
  it("wraps later headings, bodies, and subtitles in their own txt-role div, in order", () => {
    const c = cellFromNode(
      stack([
        { kind: "heading", level: 3, html: "The Pointe", role: "text0" },
        { kind: "heading", level: 4, html: "distinguished design", role: "text2" },
        { kind: "body", html: "<p>Nestled among the hills</p>", role: "text1" },
      ] as unknown as Node[]),
    );
    expect(c.title).toBe("<h3>The Pointe</h3>");
    expect(c.titleRole).toBe("text0");
    expect(c.bodyHtml).toBe(
      '<div class="txt-role-text2"><h4>distinguished design</h4></div>\n' +
        '<div class="txt-role-text1"><p>Nestled among the hills</p></div>',
    );
  });
  it("leaves a roleless body block unwrapped", () => {
    const c = cellFromNode(stack([{ kind: "body", html: "<p>plain</p>" } as unknown as Node]));
    expect(c.bodyHtml).toBe("<p>plain</p>");
  });
});

describe("cellFromNode — depth-0 multi-media subtrees split into a subgrid (gap 3a)", () => {
  it("emits one text item + one media item per media in document order", () => {
    const c = cellFromNode(
      stack([heading("Villa"), body("<p>desc</p>"), media(img("x1")), media(img("x2"))]),
    );
    expect(c.kind).toBe("subgrid");
    const sub = c.subgrid ?? [];
    expect(sub).toHaveLength(3);
    expect(sub[0]?.kind).toBe("text");
    expect(sub[0]?.title).toContain("Villa");
    expect(sub[0]?.bodyHtml).toContain("desc");
    expect(sub[1]).toMatchObject({ kind: "media", media: { assetId: "x1" } });
    expect(sub[2]).toMatchObject({ kind: "media", media: { assetId: "x2" } });
  });
  it("omits the text item when the subtree carries no text or raw html", () => {
    const c = cellFromNode(stack([media(img("y1")), media(img("y2"))]));
    expect(c.kind).toBe("subgrid");
    expect(c.subgrid?.map((s) => s.media?.assetId)).toEqual(["y1", "y2"]);
  });
});

describe("nodeToCells", () => {
  it("expands a row into one cell per grid cell, losing no media", () => {
    const cells = nodeToCells(row([media(img("a")), stack([heading("t"), media(img("b"))])]));
    expect(cells).toHaveLength(2);
    const ids = cells.flatMap((c) => (c.media ? [c.media.assetId] : []));
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });
});

describe("cellDepthExceedsTwo", () => {
  it("flags a row nested inside a subgrid cell (three row levels — past cell→subgrid)", () => {
    expect(cellDepthExceedsTwo(row([stack([row([row([media(img("a"))])])])]))).toBe(true);
  });
  it("allows cell→subgrid (depth 2)", () => {
    expect(cellDepthExceedsTwo(row([row([media(img("a"))])]))).toBe(false);
  });
  it("flags a subgrid item whose subtree nests a row inside a stack (gap 3b — band 10 shape)", () => {
    // The row is NOT directly the unboxed item node — it hides inside a
    // multi-child stack. The old guard only looked at the item node itself.
    expect(
      cellDepthExceedsTwo(
        row([row([stack([heading("Amenities", 4), row([media(img("a1")), media(img("a2"))])])])]),
      ),
    ).toBe(true);
  });
  it("flags a subgrid item whose subtree carries more than one media (gap 3b)", () => {
    expect(cellDepthExceedsTwo(row([row([stack([media(img("a")), media(img("b"))])])]))).toBe(true);
  });
});

describe("guard/builder agreement (review #2)", () => {
  // A multi-child stack ROOT: nodeToCells maps each child to a cell directly,
  // so a child row is already a subgrid — a row nested in ITS cells is one
  // level deeper than Prismic stores. The old row-depth count missed this.
  const deepStackRoot = stack([
    heading("Section", 2),
    row([row([media(img("a")), media(img("b"))]), body("<p>side</p>")]),
  ]);
  const hasIllegalNesting = (cs: CatalogCell[]): boolean =>
    cs.some((c) => c.subgrid?.some((i) => i.subgrid !== undefined) ?? false);

  it("the guard flags the tree the builder cannot store", () => {
    expect(cellDepthExceedsTwo(deepStackRoot)).toBe(true);
  });
  it("nodeToCells never emits a subgrid item that itself has a subgrid", () => {
    expect(hasIllegalNesting(nodeToCells(deepStackRoot))).toBe(false);
  });
  it("guard false ⟹ emission is legal for the plain cell→subgrid shape", () => {
    const legal = row([row([media(img("a")), body("<p>x</p>")]), media(img("c"))]);
    expect(cellDepthExceedsTwo(legal)).toBe(false);
    expect(hasIllegalNesting(nodeToCells(legal))).toBe(false);
  });
});

describe("blockPayload", () => {
  it("serializes a node tree to a {tag,children,image,html} payload preserving media + text", () => {
    const p = blockPayload(stack([heading("H"), media(img("u9"))]));
    const flat = JSON.stringify(p);
    expect(flat).toContain("u9");
    expect(flat).toContain("H");
  });
  it("renders a video media as an inline <video>, never an image url (gap 4b)", () => {
    const p = blockPayload(media(vid("v1")));
    expect(p.html).toContain("<video");
    expect(p.html).toContain("https://cdn/v1.mp4");
    expect(p.image).toBeUndefined();
  });
  it("wraps roled text leaves in their txt-role div; roleless text passes through", () => {
    const node = {
      kind: "stack",
      children: [
        { kind: "heading", level: 2, html: "Big", role: "text5" },
        { kind: "body", html: "<p>x</p>", role: "text1" },
        { kind: "heading", level: 3, html: "Plain" },
      ],
    } as unknown as Node;
    const kids = blockPayload(node).children ?? [];
    expect(kids[0]).toMatchObject({
      tag: "div",
      className: "txt-role-text5",
      children: [{ tag: "h2", html: "Big" }],
    });
    expect(kids[1]).toMatchObject({ tag: "div", className: "txt-role-text1" });
    expect(kids[2]).toMatchObject({ tag: "h3", html: "Plain" }); // no role → no wrapper
  });
});

it("threads token width/spacing, card style, and text roles onto cells", () => {
  const row: Node = {
    kind: "row",
    cells: [
      {
        token: { cols: 2, ratio: 70, raw: "grid-2-r70" },
        node: {
          kind: "stack",
          style: { "background-color": "#fff", padding: "100px 4% 80px", _valign: "middle" },
          children: [
            { kind: "heading", level: 3, html: "Card", role: "text5" },
            { kind: "body", html: "<p>Body</p>", role: "text1" },
          ],
        },
      },
      {
        token: { cols: 2, ratio: 30, raw: "grid-2-r30" },
        node: { kind: "media", media: { kind: "image", assetId: "u1", fit: "cover" } },
      },
    ],
  } as unknown as Node;

  const cells = nodeToCells(row);
  expect(cells[0]).toMatchObject({
    width: "70%",
    backgroundColor: "#fff",
    contentPadding: "100px 4% 80px",
    valign: true,
    titleRole: "text5",
    bodyHtml: '<div class="txt-role-text1"><p>Body</p></div>',
  });
  expect(cells[1]).toMatchObject({ width: "30%", kind: "media", cover: true });
});
