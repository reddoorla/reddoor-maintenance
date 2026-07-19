import type { Band, Node, Cell } from "../grid/types.js";
import type { BluxSectionSpec, CatalogCell } from "./spec.js";

/** Flatten a band root to its top-level content nodes: a `stack` yields its
 * children; a bare node yields itself. (Skeleton: one level — nested stacks are
 * a Plan-4 concern.) */
function topNodes(root: Node): Node[] {
  return root.kind === "stack" ? root.children : [root];
}

/** The first heading node's HTML becomes the section heading. */
function findHeading(nodes: Node[]): string | undefined {
  const h = nodes.find((n) => n.kind === "heading");
  return h && h.kind === "heading" ? h.html : undefined;
}

/** One row cell → one catalog cell. Media cell keeps its Media; a text-bearing
 * cell keeps heading/body HTML. (Skeleton: no embed/button/link/subgrid-from-HTML
 * detection — a media node ⇒ media, else ⇒ text.) */
function cellToCatalog(c: Cell): CatalogCell {
  const n = c.node;
  if (n.kind === "media") return { kind: "media", media: n.media };
  if (n.kind === "heading") return { kind: "text", title: n.html };
  if (n.kind === "body") return { kind: "text", body: n.html };
  if (n.kind === "stack") {
    // A cell wrapping heading+body: fold into one text cell.
    const title = n.children.find((x) => x.kind === "heading");
    const bodyN = n.children.find((x) => x.kind === "body");
    return {
      kind: "text",
      ...(title && title.kind === "heading" ? { title: title.html } : {}),
      ...(bodyN && bodyN.kind === "body" ? { body: bodyN.html } : {}),
    };
  }
  // Fallback: raw/subtitle/widget → a text cell carrying whatever HTML we have.
  const html = n.kind === "raw" ? n.html : n.kind === "subtitle" ? `<p>${n.text}</p>` : "";
  return { kind: "text", body: html };
}

/** Map a Section-like band (heading + a row of cells, optional background) to a
 * `blux_section` spec. Rows contribute their cells; a bare media/text root
 * contributes a single cell. */
export function bandToCatalogSection(band: Band): BluxSectionSpec {
  const nodes = topNodes(band.root);
  const heading = findHeading(nodes);
  const cells: CatalogCell[] = [];
  for (const n of nodes) {
    if (n.kind === "heading") continue; // consumed as the section heading
    if (n.kind === "row") cells.push(...n.cells.map(cellToCatalog));
    else cells.push(cellToCatalog({ token: { cols: 1, raw: "grid-1" }, node: n }));
  }
  return {
    slice: "BluxSection",
    index: band.index,
    ...(band.background ? { background: band.background } : {}),
    ...(heading ? { heading } : {}),
    cells,
  };
}
