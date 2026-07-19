import type { Band, Node, Cell } from "../grid/types.js";
import { classifyBand, type SliceSpec } from "../grid/index.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "./cells.js";
import type { BluxSectionSpec, CatalogCell, CatalogSpec } from "./spec.js";

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

const baseOf = (band: Band) => ({
  index: band.index,
  ...(band.background ? { background: band.background } : {}),
});

/** Map a thin routed SliceSpec + its Band to a rich CatalogSpec. Reuses the
 * battle-tested routing; builds full cells by walking the node subtree. */
export function sliceSpecToCatalog(spec: SliceSpec, band: Band): CatalogSpec {
  const base = baseOf(band);
  switch (spec.slice) {
    case "Hero":
    case "TitleBand":
    case "RichText":
      // Overlay/centered/body text → a Section; heading split out of the cells.
      return {
        slice: "BluxSection",
        ...base,
        ...splitHeadingAndCells(band.root),
      };
    case "SplitFeature":
      return {
        slice: "BluxMediaText",
        ...base,
        mediaSide: spec.mediaSide,
        layoutRatio: spec.ratio,
        media: spec.media,
        ...pick(cellFromNode(spec.text)),
      };
    case "MediaFull":
    case "VideoFeature":
      return { slice: "BluxMedia", ...base, media: spec.media };
    case "Gallery":
      return {
        slice: "BluxGallery",
        ...base,
        cells: spec.media.map(
          (m) => ({ kind: "media", media: m }) as CatalogCell,
        ),
      };
    case "Carousel":
      return {
        slice: "BluxCarousel",
        ...base,
        ...(spec.columns !== undefined ? { columnsVisible: spec.columns } : {}),
        cells: spec.slides.map(
          (s) =>
            ({
              kind: "media",
              media: s.media,
              ...(s.caption ? { title: s.caption.html } : {}),
            }) as CatalogCell,
        ),
      };
    case "LocationMap":
      // 4a: no isMapMount injected, so this only fires if a caller injects it;
      // preserve content via the fallback.
      return { slice: "BluxBlock", ...base, payload: blockPayload(band.root) };
    case "Grid":
    default: {
      // Rich grid when it fits the depth-2 model; else the opaque fallback.
      if (cellDepthExceedsTwo(spec.root))
        return {
          slice: "BluxBlock",
          ...base,
          payload: blockPayload(spec.root),
        };
      return { slice: "BluxGrid", ...base, ...splitHeadingAndCells(spec.root) };
    }
  }
}

/** The band router: reuse classifyBand for routing, enrich to catalog. */
export function bandToCatalog(band: Band): CatalogSpec {
  return sliceSpecToCatalog(classifyBand(band), band);
}

// -- helpers --
/** Split a root into its section heading (first heading-only cell) + the
 * remaining content cells, so the heading is not duplicated as both the
 * section heading AND a cell title. */
function splitHeadingAndCells(root: Node): {
  heading?: string;
  cells: CatalogCell[];
} {
  const cells = nodeToCells(root).filter(
    (c) => c.title || c.body || c.media || c.subgrid,
  );
  const hIdx = cells.findIndex(
    (c) => c.title && !c.body && !c.media && !c.subgrid,
  );
  const h = hIdx >= 0 ? cells[hIdx] : undefined;
  if (h)
    return {
      ...(h.title ? { heading: h.title } : {}),
      cells: cells.filter((_, i) => i !== hIdx),
    };
  return { cells };
}
function pick(c: CatalogCell): { title?: string; body?: string } {
  return {
    ...(c.title ? { title: c.title } : {}),
    ...(c.body ? { body: c.body } : {}),
  };
}
