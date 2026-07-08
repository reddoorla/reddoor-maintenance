import type { Band, Cell, Media, Node } from "./types.js";
import type { SliceSpec } from "./slice-spec.js";

/** Depth-first collect of every `media` node's `Media` in a subtree. */
export function collectMedia(node: Node): Media[] {
  switch (node.kind) {
    case "media":
      return [node.media];
    case "row":
      return node.cells.flatMap((c) => collectMedia(c.node));
    case "stack":
      return node.children.flatMap(collectMedia);
    case "heading":
    case "body":
    case "subtitle":
    case "widget":
    case "raw":
      return [];
  }
}

/** Depth-first collect of text nodes (heading/body/subtitle). */
export function collectText(node: Node): Node[] {
  switch (node.kind) {
    case "heading":
    case "body":
    case "subtitle":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectText(c.node));
    case "stack":
      return node.children.flatMap(collectText);
    case "media":
    case "widget":
    case "raw":
      return [];
  }
}

/** The cells of the root row, or null when the root is not a single row. A
 * `stack` whose only child is a row also counts (Blux wraps rows in holders). */
export function topRow(node: Node): Cell[] | null {
  if (node.kind === "row") return node.cells;
  if (node.kind === "stack" && node.children.length === 1) {
    const [only] = node.children;
    if (only && only.kind === "row") return only.cells;
  }
  return null;
}

/** A `raw` node carrying no rendered text or nested block — the shape a
 * client-injected mount (e.g. the map container) parses to. */
export function isEmptyRaw(node: Node): boolean {
  if (node.kind !== "raw") return false;
  const text = node.html.replace(/<[^>]*>/g, "").trim();
  return text.length === 0;
}

/** Options for the classifier. `isMapMount` is injected by plan 4
 * (`extract-map.ts`); by default nothing is recognized as a map. */
export type ClassifyOptions = {
  isMapMount?: (node: Node) => boolean;
};

/** The band's slice-zone base carried onto every spec (conditional spread keeps
 * `background` absent, not `undefined`, under exactOptionalPropertyTypes). */
function base(band: Band): { index: number; background?: Media } {
  return { index: band.index, ...(band.background ? { background: band.background } : {}) };
}

/** Plain text of a heading/subtitle/body node (tags stripped, whitespace collapsed). */
function nodeText(node: Node): string {
  const html =
    node.kind === "heading" || node.kind === "body"
      ? node.html
      : node.kind === "subtitle"
        ? node.text
        : "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** If every cell of a row is exactly one media node, return them in order. */
function galleryMedia(cells: Cell[]): Media[] | null {
  const out: Media[] = [];
  for (const c of cells) {
    if (c.node.kind !== "media") return null;
    out.push(c.node.media);
  }
  return out.length >= 2 ? out : null;
}

/** Classify one band into a SliceSpec. Conservative: only unambiguous shapes
 * become pattern slices; everything else is a render-faithful Grid fallback. */
export function classifyBand(band: Band, opts: ClassifyOptions = {}): SliceSpec {
  void opts; // used by the widget router (Task 8)

  const root = band.root;
  const media = collectMedia(root);
  const text = collectText(root);
  const row = topRow(root);
  const headings = text.filter((n) => n.kind === "heading");
  const subtitles = text.filter((n) => n.kind === "subtitle");
  const bodies = text.filter((n) => n.kind === "body");

  // Text-only bands (no media, no row).
  if (media.length === 0 && row === null) {
    if (headings.length > 0 && !band.background) {
      const first = headings[0];
      const sub = subtitles[0];
      return {
        slice: "TitleBand",
        ...base(band),
        heading: first ? nodeText(first) : "",
        ...(sub ? { subtitle: nodeText(sub) } : {}),
      };
    }
    if (headings.length === 0 && bodies.length > 0 && !band.background) {
      return {
        slice: "RichText",
        ...base(band),
        html: bodies.map((b) => (b.kind === "body" ? b.html : "")).join("\n"),
      };
    }
  }

  // Full-bleed hero: a background image with overlay text and no grid row.
  if (band.background && headings.length > 0 && row === null && media.length === 0) {
    const h = headings[0];
    const sub = subtitles[0];
    const bod = bodies[0];
    return {
      slice: "Hero",
      ...base(band),
      ...(h ? { heading: nodeText(h) } : {}),
      ...(sub ? { subtitle: nodeText(sub) } : {}),
      ...(bod && bod.kind === "body" ? { body: bod.html } : {}),
    };
  }

  // Gallery: a row whose cells are all single media.
  if (row) {
    const gm = galleryMedia(row);
    if (gm) return { slice: "Gallery", ...base(band), media: gm };
  }

  // MediaFull: one media, no text.
  if (media.length === 1 && text.length === 0) {
    const m = media[0];
    if (m) return { slice: "MediaFull", ...base(band), media: m };
  }

  return { slice: "Grid", ...base(band), root: band.root };
}

export function classifyBands(bands: Band[], opts: ClassifyOptions = {}): SliceSpec[] {
  return bands.map((b) => classifyBand(b, opts));
}
