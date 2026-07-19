import type { Media, Node } from "../grid/types.js";
import { collectMedia } from "../grid/index.js";
// `collectText` is not re-exported via the grid barrel (index.ts) — import it
// from its module directly.
import { collectText } from "../grid/classify-band.js";
import type { BlockNode, CatalogCell } from "./spec.js";

/** Peel one-child style-box stacks (mirror of classify-band unboxed). */
function unbox(n: Node): Node {
  let cur = n;
  while (cur.kind === "stack" && cur.children.length === 1) {
    const only = cur.children[0];
    if (!only) break;
    cur = only;
  }
  return cur;
}

/** First heading html and joined body html under a node (recursive), so a card
 * that buries its heading/body in sub-stacks still yields title/body. */
function textOf(n: Node): { title?: string; body?: string } {
  const text = collectText(n);
  const h = text.find((t) => t.kind === "heading");
  const bodies = text.filter((t) => t.kind === "body");
  const subs = text.filter((t) => t.kind === "subtitle");
  const title = h && h.kind === "heading" ? h.html : undefined;
  const bodyParts = [
    ...bodies.map((b) => (b.kind === "body" ? b.html : "")),
    ...subs.map((s) => (s.kind === "subtitle" ? `<p>${s.text}</p>` : "")),
  ].filter(Boolean);
  return {
    ...(title ? { title } : {}),
    ...(bodyParts.length ? { body: bodyParts.join("\n") } : {}),
  };
}

/** True if `node` nests a row below the cell→subgrid depth (i.e. a row that
 * contains a cell that (recursively) contains another row). Such a band cannot
 * render in Prismic's one-nesting-level model → caller falls back to BluxBlock. */
export function cellDepthExceedsTwo(node: Node): boolean {
  const rowDepth = (n: Node, depth: number): number => {
    const u = unbox(n);
    if (u.kind === "row") {
      const child = Math.max(
        0,
        ...u.cells.map((c) => rowDepth(c.node, depth + 1)),
      );
      return Math.max(depth + 1, child);
    }
    if (u.kind === "stack")
      return Math.max(depth, ...u.children.map((c) => rowDepth(c, depth)));
    return depth;
  };
  return rowDepth(node, 0) > 2;
}

/** One node → one catalog cell. A nested row becomes a subgrid (one level); a
 * media anywhere inside is captured; heading/body are pulled recursively. */
export function cellFromNode(node: Node): CatalogCell {
  const u = unbox(node);
  if (u.kind === "row") {
    return {
      kind: "subgrid",
      subgrid: u.cells.map((c) => cellFromNode(c.node)),
    };
  }
  const media = collectMedia(u)[0];
  const { title, body } = textOf(u);
  if (u.kind === "media" || (media && !title && !body)) {
    return {
      kind: "media",
      ...(media ? { media } : {}),
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
    };
  }
  return {
    kind: "text",
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(media ? { media } : {}),
  };
}

/** A row's cells → catalog cells; a bare content node → a single cell. */
export function nodeToCells(node: Node): CatalogCell[] {
  const u = unbox(node);
  if (u.kind === "row") return u.cells.map((c) => cellFromNode(c.node));
  if (u.kind === "stack") return u.children.map(cellFromNode);
  return [cellFromNode(u)];
}

/** Serialize a node tree to a BluxBlock payload — the content-preserving
 * fallback for bands too deep/irregular for the cell model. Never drops media
 * or text (the whole point). */
export function blockPayload(node: Node): BlockNode {
  const u = node;
  switch (u.kind) {
    case "row":
      return {
        tag: "div",
        style: { display: "grid" },
        children: u.cells.map((c) => blockPayload(c.node)),
      };
    case "stack":
      return { tag: "div", children: u.children.map(blockPayload) };
    case "heading":
      return { tag: `h${u.level}`, html: u.html };
    case "body":
      return { tag: "div", html: u.html };
    case "subtitle":
      return { tag: "p", html: u.text };
    case "media":
      return mediaBlock(u.media);
    case "raw":
      return { html: u.html };
    case "widget":
      return { tag: "div", html: "" }; // 4b captures widget html
  }
}

function mediaBlock(m: Media): BlockNode {
  const url = m.base
    ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}`
    : m.assetId;
  // `Media` (grid/types.ts) carries no alt — asset alt lives in the IR asset
  // index and is resolved at emit/migrate time, not here.
  return { tag: "figure", image: { url, alt: "" } };
}
