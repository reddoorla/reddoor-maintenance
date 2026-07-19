import type { Band, Node } from "../grid/types.js";
import { classifyBand, type SliceSpec } from "../grid/index.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "./cells.js";
import type { CatalogCell, CatalogSpec } from "./spec.js";

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
