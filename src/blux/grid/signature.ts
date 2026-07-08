import type { Band, Node } from "./types.js";

/** A compact, stable string form of a node's structure (kinds + tokens, no prose),
 * used to snapshot layout fidelity and (in plan 6) diff a converted page against
 * the answer key. */
function sig(node: Node): string {
  switch (node.kind) {
    case "row":
      return `row[${node.cells
        .map((c) => `${c.token.raw}:${sig(c.node)}`)
        .join(",")}]`;
    case "stack":
      return `stack[${node.children.map(sig).join(",")}]`;
    case "heading":
      return `h${node.level}`;
    case "body":
      return "body";
    case "subtitle":
      return "subtitle";
    case "media":
      return `media:${node.media.kind}`;
    case "widget":
      return `widget:${node.widget.type}`;
    case "raw":
      return "raw";
  }
}

/** One signature line per band: `bandN(bg?): <node-signature>`. */
export function gridSignature(bands: Band[]): string[] {
  return bands.map(
    (b) => `band${b.index}${b.background ? "(bg)" : ""}: ${sig(b.root)}`,
  );
}
