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

/** Classify one band into a SliceSpec. Conservative: only unambiguous shapes
 * become pattern slices; everything else is a render-faithful Grid fallback. */
export function classifyBand(band: Band, opts: ClassifyOptions = {}): SliceSpec {
  void opts; // used by the widget router (Task 8)
  return { slice: "Grid", ...base(band), root: band.root };
}

export function classifyBands(bands: Band[], opts: ClassifyOptions = {}): SliceSpec[] {
  return bands.map((b) => classifyBand(b, opts));
}
