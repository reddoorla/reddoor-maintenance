import type { Band, Media, Node } from "../grid/types.js";
import type { MapConfig } from "../grid/extract-map.js";
import {
  classifyBand,
  collectMedia,
  type CarouselSlide,
  type SliceSpec,
} from "../grid/index.js";
import {
  cellFromNode,
  nodeToCells,
  blockPayload,
  cellDepthExceedsTwo,
} from "./cells.js";
import { cropRatioOf, isFeedBand } from "../grid/feed-grid.js";
import { feedEntityType } from "./feeds.js";
import type {
  BluxBlockSpec,
  BluxCollectionSpec,
  BluxGridSpec,
  CatalogCell,
  CatalogSpec,
} from "./spec.js";

type CatalogBaseFields = { index: number; background?: Media };

/** Options threaded from the caller (the CLI catalog action extracts them per
 * page): `isMapMount` is the classifier's mount predicate (grid
 * `ClassifyOptions`), `mapConfig` the page's extracted map config carried onto
 * the resulting BluxSectionSpec for emit. */
export type BandToCatalogOptions = {
  isMapMount?: (node: Node) => boolean;
  mapConfig?: MapConfig;
};

const baseOf = (band: Band): CatalogBaseFields => ({
  index: band.index,
  ...(band.background ? { background: band.background } : {}),
});

/** Map a thin routed SliceSpec + its Band to a rich CatalogSpec. Reuses the
 * battle-tested routing; builds full cells by walking the node subtree. */
export function sliceSpecToCatalog(
  spec: SliceSpec,
  band: Band,
  opts: BandToCatalogOptions = {},
): CatalogSpec {
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
      // Promote to the thin two-field slice ONLY when the media is an image
      // and the text half really is just title+body. A video cannot ride the
      // slice's Image field (the `{__asset_id}` marker would dangle — videos
      // are excluded from image uploads — silent total loss), and a media/
      // subgrid/raw-bearing text half cannot ride BluxMediaText (band 1's
      // text half holds 2 images) — refuse the lossy promotion, mirroring
      // classifyBand's own philosophy, and enrich the WHOLE band through the
      // grid path (where a video becomes an embed_html <video> cell) so
      // nothing is dropped.
      if (spec.media.kind !== "video" && !text.media && !text.subgrid && !text.embedHtml)
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
    case "LocationMap": {
      // Decision B (4b): the map band becomes a BluxSection carrying the
      // ORIGINAL mount raw html as a widget. classifyBand rewrote a COPY of
      // the tree (widget nodes carry no html) — band.root still holds the raw
      // mount node, so re-find it with the same predicate. Emit sanitizes and
      // inlines the MapConfig; classify keeps the html pristine.
      const mountHtml = opts.isMapMount
        ? findMountHtml(band.root, opts.isMapMount)
        : undefined;
      if (!mountHtml) return blockSpec(band.root, base); // predicate-less caller: 4a fallback
      return {
        slice: "BluxSection",
        ...base,
        cells: [],
        widgetKind: "map",
        widgetHtml: mountHtml,
        ...(opts.mapConfig ? { mapConfig: opts.mapConfig } : {}),
      };
    }
    case "Grid":
    default:
      // Rich grid when it fits the depth-2 model; else the opaque fallback.
      return gridOrBlock(spec.root, base);
  }
}

/** The band router: reuse classifyBand for routing, enrich to catalog.
 * `opts.isMapMount` flows into the grid classifier (LocationMap promotion)
 * AND into the LocationMap enrichment above (mount html recovery). */
export function bandToCatalog(
  band: Band,
  opts: BandToCatalogOptions = {},
): CatalogSpec {
  return sliceSpecToCatalog(classifyBand(band, opts), band, opts);
}

/** Feed-band interception (spec §7 rule 1): a band whose site.json item
 * declares `sources[]` becomes a BluxCollection query spec BEFORE the grid
 * router runs — EXCEPT `__media` (media-library galleries already materialize
 * via the grid path) and non-feed items, which fall through to `bandToCatalog`
 * unchanged. `item` is the positional convert-path join:
 * `siteJson.content.pages[p].items[band.index]`. */
export function bandOrCollection(
  band: Band,
  item: unknown,
  feeds: Record<string, { name?: unknown } | undefined>,
  opts: BandToCatalogOptions = {},
): CatalogSpec {
  if (!isFeedBand(item)) return bandToCatalog(band, opts);
  const feedIds = item.sources.map(String);
  if (feedIds[0] === "__media") return bandToCatalog(band, opts);
  const cfg = item.sourceConfig ?? {};
  const filterTag = (cfg["filters"] as { tag?: unknown } | undefined)?.tag;
  const sort = cfg["sort"];
  const limit = Number(cfg["count"]);
  const mediaRatio = cropRatioOf(cfg["mediaRatio"] ?? cfg["ratio"]);
  const { heading } = splitHeadingAndCells(band.root);
  const spec: BluxCollectionSpec = {
    slice: "BluxCollection",
    ...baseOf(band),
    ...(heading ? { heading } : {}),
    entityType: feedEntityType(String(feeds[feedIds[0]!]?.name ?? "")),
    feedIds,
    ...(typeof filterTag === "string" && filterTag ? { filterTag } : {}),
    ...(typeof sort === "string" && sort ? { sort } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(mediaRatio ? { mediaRatio } : {}),
    layout:
      (item as { type?: unknown }).type === "slides" ? "carousel" : "grid",
    ...(cfg["scrollLoadMore"] === true ? { scrollLoadMore: true } : {}),
  };
  return spec;
}

// -- helpers --
/** Depth-first search for the mount node's raw html in the UNREWRITTEN band
 * tree (the predicate only ever matches `raw` nodes — see makeIsMapMount). */
function findMountHtml(
  node: Node,
  isMount: (n: Node) => boolean,
): string | undefined {
  if (node.kind === "raw" && isMount(node)) return node.html;
  const children =
    node.kind === "row"
      ? node.cells.map((c) => c.node)
      : node.kind === "stack"
        ? node.children
        : [];
  for (const c of children) {
    const found = findMountHtml(c, isMount);
    if (found !== undefined) return found;
  }
  return undefined;
}
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
  return {
    slice: "BluxBlock",
    ...base,
    payload: blockPayload(root),
    // Surfaced so emit uploads the payload's assets; the payload's inlined
    // urls remain CDN until the 4d migrate-time rewrite.
    media: collectMedia(root),
  };
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
