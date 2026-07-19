import { describe, it, expect } from "vitest";
import type { Node, Media } from "../../../src/blux/grid/types.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "../../../src/blux/catalog/cells.js";

const img = (id: string): Media => ({ kind: "image", assetId: id });
const heading = (html: string): Node => ({ kind: "heading", level: 3, html });
const body = (html: string): Node => ({ kind: "body", html });
const media = (m: Media): Node => ({ kind: "media", media: m });
const cell = (node: Node) => ({ token: { cols: 1, raw: "grid-1" }, node });
const row = (nodes: Node[]): Node => ({ kind: "row", cells: nodes.map(cell) });
const stack = (children: Node[]): Node => ({ kind: "stack", children });

describe("cellFromNode", () => {
  it("captures media + heading + body co-located in a sub-stack (skeleton dropped these)", () => {
    const c = cellFromNode(
      stack([
        heading("<h3>The Pointe</h3>"),
        media(img("u1")),
        body("<p>x</p>"),
      ]),
    );
    expect(c.media?.assetId).toBe("u1");
    expect(c.title).toContain("The Pointe");
    expect(c.body).toContain("x");
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

describe("nodeToCells", () => {
  it("expands a row into one cell per grid cell, losing no media", () => {
    const cells = nodeToCells(
      row([media(img("a")), stack([heading("<h3>t</h3>"), media(img("b"))])]),
    );
    expect(cells).toHaveLength(2);
    const ids = cells.flatMap((c) => (c.media ? [c.media.assetId] : []));
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });
});

describe("cellDepthExceedsTwo", () => {
  it("flags a row nested inside a subgrid cell (three row levels — past cell→subgrid)", () => {
    // Depth counts ROW levels (stacks are transparent, mirroring cellFromNode's
    // unbox): row→cell→row is the allowed cell→subgrid shape, so exceeding
    // needs a THIRD row level buried in a subgrid cell.
    expect(
      cellDepthExceedsTwo(row([stack([row([row([media(img("a"))])])])])),
    ).toBe(true);
  });
  it("allows cell→subgrid (depth 2)", () => {
    expect(cellDepthExceedsTwo(row([row([media(img("a"))])]))).toBe(false);
  });
});

describe("blockPayload", () => {
  it("serializes a node tree to a {tag,children,image,html} payload preserving media + text", () => {
    const p = blockPayload(stack([heading("<h3>H</h3>"), media(img("u9"))]));
    const flat = JSON.stringify(p);
    expect(flat).toContain("u9");
    expect(flat).toContain("H");
  });
});
