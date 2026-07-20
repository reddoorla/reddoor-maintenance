import type { Band, Media, Node } from "../grid/types.js";
import {
  classifyBand,
  type CarouselSlide,
  type SliceSpec,
} from "../grid/index.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "./cells.js";
import type {
  BluxBlockSpec,
  BluxGridSpec,
  CatalogCell,
  CatalogSpec,
} from "./spec.js";

type CatalogBaseFields = { index: number; background?: Media };

const baseOf = (band: Band): CatalogBaseFields => ({
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
    case "SplitFeature": {
      const text = cellFromNode(spec.text);
      // Promote to the thin two-field slice ONLY when the text half really is
      // just title+body. A media/subgrid/raw-bearing text half cannot ride
      // BluxMediaText (band 1's text half holds 2 images) — refuse the lossy
      // promotion, mirroring classifyBand's own philosophy, and enrich the
      // WHOLE band through the grid path so nothing is dropped.
      if (!text.media && !text.subgrid && !text.embedHtml)
        return {
          slice: "BluxMediaText",
          ...base,
          mediaSide: spec.mediaSide,
          layoutRatio: spec.ratio,
          media: spec.media,
          ...pick(text),
        };
      return gridOrBlock(band.root, base);
    }
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
        cells: spec.slides.map(slideCell),
      };
    case "LocationMap":
      // 4a: no isMapMount injected, so this only fires if a caller injects it;
      // preserve content via the fallback.
      return blockSpec(band.root, base);
    case "Grid":
    default:
      // Rich grid when it fits the depth-2 model; else the opaque fallback.
      return gridOrBlock(spec.root, base);
  }
}

/** The band router: reuse classifyBand for routing, enrich to catalog. */
export function bandToCatalog(band: Band): CatalogSpec {
  return sliceSpecToCatalog(classifyBand(band), band);
}

// -- helpers --
/** One carousel slide → a media cell. The caption html is wrapper-less in the
 * parser, so it is wrapped at the slide's own heading level; the subcaption
 * (the hero slide's location line) rides the cell body. */
function slideCell(s: CarouselSlide): CatalogCell {
  return {
    kind: "media",
    media: s.media,
    ...(s.caption
      ? { title: `<h${s.caption.level}>${s.caption.html}</h${s.caption.level}>` }
      : {}),
    ...(s.subcaption ? { body: s.subcaption.html } : {}),
  };
}

/** Rich grid when the tree fits the cell→subgrid model; else the
 * content-preserving BluxBlock fallback (guard and builder agree by
 * construction — see cellDepthExceedsTwo). */
function gridOrBlock(
  root: Node,
  base: CatalogBaseFields,
): BluxGridSpec | BluxBlockSpec {
  if (cellDepthExceedsTwo(root)) return blockSpec(root, base);
  const columns = gridColumns(root);
  return {
    slice: "BluxGrid",
    ...base,
    ...(columns !== undefined ? { columns } : {}),
    ...splitHeadingAndCells(root),
  };
}

function blockSpec(root: Node, base: CatalogBaseFields): BluxBlockSpec {
  return { slice: "BluxBlock", ...base, payload: blockPayload(root) };
}

/** The top row's column count: the grid token's cols, or the row's cell count
 * when the token doesn't say ("any"). */
function gridColumns(root: Node): number | undefined {
  const findRow = (n: Node): Extract<Node, { kind: "row" }> | null => {
    if (n.kind === "row") return n;
    if (n.kind === "stack") {
      for (const c of n.children) {
        const r = findRow(c);
        if (r) return r;
      }
    }
    return null;
  };
  const row = findRow(root);
  if (!row || row.cells.length === 0) return undefined;
  const cols = row.cells[0]?.token.cols;
  return typeof cols === "number" ? cols : row.cells.length;
}

/** Split a root into its section heading (first heading-only cell) + the
 * remaining content cells, so the heading is not duplicated as both the
 * section heading AND a cell title. */
function splitHeadingAndCells(root: Node): {
  heading?: string;
  cells: CatalogCell[];
} {
  const cells = nodeToCells(root).filter(
    (c) => c.title || c.body || c.media || c.subgrid || c.embedHtml,
  );
  const hIdx = cells.findIndex(
    (c) => c.title && !c.body && !c.media && !c.subgrid && !c.embedHtml,
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
