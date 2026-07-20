import type { Media, Node } from "../grid/types.js";
import { collectMedia, blockPlainText } from "../grid/index.js";
// `collectText`/`isEmptyRaw` are not re-exported via the grid barrel
// (index.ts) — import them from their module directly.
import { collectText, isEmptyRaw } from "../grid/classify-band.js";
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

/** Raw nodes under a node (recursive). classify-band has the same helper but
 * does not export it — reimplemented locally rather than widening the grid
 * module's public surface. */
function collectRaws(node: Node): Extract<Node, { kind: "raw" }>[] {
  switch (node.kind) {
    case "raw":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectRaws(c.node));
    case "stack":
      return node.children.flatMap(collectRaws);
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
      return [];
  }
}

/** The joined non-empty raw html under a node — a cell's `embedHtml`. Keeps
 * the visible runs the text model would otherwise drop (the-pointe's 'Visit
 * Website' link buttons parse to `raw`); empty raws are client-mount shells. */
function rawHtmlOf(node: Node): string | undefined {
  const raws = collectRaws(node).filter((r) => !isEmptyRaw(r));
  return raws.length ? raws.map((r) => r.html).join("\n") : undefined;
}

/** Title + body html under a node (recursive, document order). The FIRST
 * non-blank heading becomes the title; every LATER heading is folded into the
 * body parts in document order relative to bodies/subtitles, so no heading is
 * dropped. The parser's `heading.html` carries no `<hN>` wrapper, so headings
 * are wrapped here — otherwise `htmlAsRichText` resolves them to `paragraph`
 * nodes, violating heading-only StructuredText fields and losing levels. */
function textOf(n: Node): { title?: string; body?: string } {
  let title: string | undefined;
  const bodyParts: string[] = [];
  for (const t of collectText(n)) {
    if (t.kind === "heading") {
      if (blockPlainText(t.html) === "") continue; // whitespace-only heading
      const wrapped = `<h${t.level}>${t.html}</h${t.level}>`;
      if (title === undefined) title = wrapped;
      else bodyParts.push(wrapped);
    } else if (t.kind === "body") {
      if (t.html) bodyParts.push(t.html);
    } else if (t.kind === "subtitle") {
      bodyParts.push(`<p>${t.text}</p>`);
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(bodyParts.length ? { body: bodyParts.join("\n") } : {}),
  };
}

/** Shared build state: `flattened` records that a row was met at subgrid-item
 * depth and its structure could not be stored (see `cellDepthExceedsTwo`). */
type CellBuildState = { flattened: boolean };

/** One node → one catalog cell. `depth` 0 builds a top-level cell (a row
 * becomes a subgrid — the ONE nesting level the Prismic model stores); at
 * subgrid-item depth (1) a nested row CANNOT be stored, so its content is
 * flattened into the cell (first media + all text + raws) and the loss is
 * recorded on `state` — builder and guard can never disagree on legality. */
function buildCell(node: Node, depth: number, state: CellBuildState): CatalogCell {
  const u = unbox(node);
  if (u.kind === "row" && depth === 0) {
    return {
      kind: "subgrid",
      subgrid: u.cells.map((c) => buildCell(c.node, depth + 1, state)),
    };
  }
  if (u.kind === "row") state.flattened = true;
  const media = collectMedia(u)[0];
  const { title, body } = textOf(u);
  const embedHtml = rawHtmlOf(u);
  if (u.kind === "media" || (media && !title && !body)) {
    return {
      kind: "media",
      ...(media ? { media } : {}),
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(embedHtml ? { embedHtml } : {}),
    };
  }
  return {
    kind: title || body ? "text" : embedHtml ? "embed" : "text",
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(media ? { media } : {}),
    ...(embedHtml ? { embedHtml } : {}),
  };
}

/** One node → one catalog cell (public wrapper; the cell is top-level). */
export function cellFromNode(node: Node): CatalogCell {
  return buildCell(node, 0, { flattened: false });
}

function buildCells(node: Node, state: CellBuildState): CatalogCell[] {
  const u = unbox(node);
  if (u.kind === "row") return u.cells.map((c) => buildCell(c.node, 0, state));
  if (u.kind === "stack") return u.children.map((c) => buildCell(c, 0, state));
  return [buildCell(u, 0, state)];
}

/** A row's cells → catalog cells; a bare content node → a single cell. Never
 * emits a subgrid item that itself has a subgrid (rows past that depth are
 * flattened — see `buildCell`). */
export function nodeToCells(node: Node): CatalogCell[] {
  return buildCells(node, { flattened: false });
}

/** True when `node` needs more nesting than the cell model stores — i.e.
 * building its cells would flatten a row at subgrid-item depth. Implemented BY
 * running the builder, so guard and emission share one source of truth:
 * guard false ⟹ `nodeToCells` output is structure-complete and legal;
 * guard true ⟹ the caller should fall back to BluxBlock. */
export function cellDepthExceedsTwo(node: Node): boolean {
  const state: CellBuildState = { flattened: false };
  buildCells(node, state);
  return state.flattened;
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
