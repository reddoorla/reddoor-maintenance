import type { Band, Media, Node } from "../grid/types.js";
import type { MapConfig } from "../grid/extract-map.js";
import type { Diagnostic } from "../ir.js";
import type { BlockDefaults } from "../emit/block-styles.js";
import { classifyBand, collectMedia, type CarouselSlide, type SliceSpec } from "../grid/index.js";
import { cellFromNode, nodeToCells, blockPayload, cellDepthExceedsTwo } from "./cells.js";
import { cropRatioOf, isFeedBand } from "../grid/feed-grid.js";
import { feedEntityType, isSkippedFeed } from "./feeds.js";
import { hasVisibleContent } from "./sanitize.js";
import type {
  BluxBlockSpec,
  BluxCollectionSpec,
  BluxGridSpec,
  CatalogCell,
  CatalogSpec,
} from "./spec.js";

type CatalogBaseFields = {
  index: number;
  background?: Media;
  backgroundColor?: string;
  minHeight?: string;
  contentPadding?: string;
  contentPaddingMobile?: string;
  maxContentWidth?: string;
  verticalAlign?: string;
  textAlign?: string;
  columnWidth?: string;
  columnSide?: string;
  headingRole?: string;
};

/** Options threaded from the caller (the CLI catalog action extracts them per
 * page): `isMapMount` is the classifier's mount predicate (grid
 * `ClassifyOptions`), `mapConfig` the page's extracted map config carried onto
 * the resulting BluxSectionSpec for emit. */
export type BandToCatalogOptions = {
  isMapMount?: (node: Node) => boolean;
  mapConfig?: MapConfig;
  /** Classify-time diagnostics sink (positional-join misalignments, unknown/
   * skipped feed sources). Absent → those findings go unrecorded, never throw. */
  diagnostics?: Diagnostic[];
  /** The page being classified — rides diagnostic `where` as `<uid>:<band>`
   * so same-index findings on different pages stay distinguishable (round-2
   * item 10a: fitHealthClub's 4 band-3 diagnostics were identical). */
  pageUid?: string;
  /** Per-band inline block styles keyed by band index (background-color,
   * min-height, text-align, vertical-align, …) — the CLI supplies
   * `blockStylesByIndex(siteJson, pageIndex)`. `baseOf` reads `.get(band.index)`. */
  styles?: Map<number, Record<string, string>>;
  /** Block-class `.blocksNcontainer` defaults (padding/mobilePadding/maxWidth)
   * keyed by the wrapper class — the CLI supplies `blockClassDefaults(siteJson)`.
   * `baseOf` reads `.get(band.blockClass)`, mirroring presentation.ts. */
  defaults?: Map<string, BlockDefaults>;
};

/** Band-visual fields recovered from the CLI-threaded per-band inline styles
 * (`opts.styles.get(index)`) + the wrapper class defaults
 * (`opts.defaults.get(band.blockClass)`), mirroring presentation.ts's
 * styleFor/defaultsFor resolution. An inline `padding` overrides the class
 * default; every field is omitted when its source is absent (graceful
 * degradation — a site without block styles emits an unstyled band). */
const baseOf = (band: Band, opts?: BandToCatalogOptions): CatalogBaseFields => {
  const st = opts?.styles?.get(band.index) ?? {};
  const def = (band.blockClass ? opts?.defaults?.get(band.blockClass) : undefined) ?? {};
  const padding = st["padding"] ?? def.padding;
  return {
    index: band.index,
    ...(band.background ? { background: band.background } : {}),
    ...(st["background-color"] ? { backgroundColor: st["background-color"] } : {}),
    ...(st["min-height"] ? { minHeight: st["min-height"] } : {}),
    ...(st["text-align"] ? { textAlign: st["text-align"] } : {}),
    ...(st["vertical-align"] === "middle" ? { verticalAlign: "middle" } : {}),
    ...(padding ? { contentPadding: padding } : {}),
    ...(def.mobilePadding ? { contentPaddingMobile: def.mobilePadding } : {}),
    ...(def.maxWidth ? { maxContentWidth: def.maxWidth } : {}),
    ...(st["_column-width"] ? { columnWidth: st["_column-width"] } : {}),
    ...(st["_column-side"] ? { columnSide: st["_column-side"] } : {}),
  };
};

/** Map a thin routed SliceSpec + its Band to a rich CatalogSpec. Reuses the
 * battle-tested routing; builds full cells by walking the node subtree. */
export function sliceSpecToCatalog(
  spec: SliceSpec,
  band: Band,
  opts: BandToCatalogOptions = {},
): CatalogSpec {
  const base = baseOf(band, opts);
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
        cells: spec.media.map((m) => ({ kind: "media", media: m }) as CatalogCell),
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
      // ORIGINAL mount raw html as a widget (see liftMapWidget). Emit
      // sanitizes and inlines the MapConfig; classify keeps the html pristine.
      const widget = liftMapWidget(band, opts);
      if (!widget) return blockSpec(band.root, base); // predicate-less caller: 4a fallback
      return { slice: "BluxSection", ...base, cells: [], ...widget };
    }
    case "Grid":
    default: {
      // Rich grid when it fits the depth-2 model; else the opaque fallback.
      // Round 3: every REAL fleet map band holds the mount PLUS panel rows,
      // so it routes HERE (never LocationMap) — and classifyBand's rewrite
      // left an html-less widget node in spec.root, which the Block path
      // serialized as an empty div: map, legend chips, and MapConfig silently
      // vanished from the plan. Lift the ORIGINAL mount from band.root onto
      // the container spec (the CatalogBase widget triple — both BluxGrid and
      // the BluxBlock fallback carry it); when the band holds a mount the
      // lift cannot recover, say so — never silent.
      const widget = liftMapWidget(band, opts);
      if (!widget) reportUnrecoveredMount(spec.root, band, opts);
      return { ...gridOrBlock(spec.root, base), ...(widget ?? {}) };
    }
  }
}

/** The band router: reuse classifyBand for routing, enrich to catalog.
 * `opts.isMapMount` flows into the grid classifier (LocationMap promotion)
 * AND into the LocationMap enrichment above (mount html recovery). */
export function bandToCatalog(band: Band, opts: BandToCatalogOptions = {}): CatalogSpec {
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
  const where = whereOf(band, opts);
  const feedIds = item.sources.map(String);
  if (feedIds[0] === "__media") {
    // Media-library galleries materialize via the grid path — but that path
    // renders sources[0] only, so any EXTRA source riding the same item would
    // be silently unconsumed (round-2 item 5): diagnose each.
    for (const id of feedIds.slice(1))
      opts.diagnostics?.push({
        kind: "skipped-feed",
        where,
        message: `band ${band.index} sources "${id}" alongside __media — the media-library grid renders sources[0] only, the extra source is not consumed`,
      });
    return bandToCatalog(band, opts);
  }
  // Positional-join guard (mirrors convert.ts materializeFeedBands): only a
  // band that lost its content to the feed-template drop is a real feed grid.
  // A CONTENT-BEARING band whose positional item carries sources means the
  // site.json join landed on the wrong band — routing it to a BluxCollection
  // would clobber its parsed content, so it falls through to bandToCatalog.
  // Emptyishness IGNORES pure feed-template mounts (round-2 item 1: the real
  // fitHealthClub band-3 root is `<div data-exec="custom_…">` — the Blux feed
  // placeholder the collection replaces, not content) and the page's map
  // mount (a widget the collection lifts below, not content either).
  if (!isEmptyish(band.root, (n) => isFeedTemplateMount(n) || (opts.isMapMount?.(n) ?? false))) {
    opts.diagnostics?.push({
      kind: "feed-band-misalign",
      where,
      message: `band ${band.index} has parsed content but its site.json item carries feed sources — positional join misaligned, classified as content`,
    });
    return bandToCatalog(band, opts);
  }
  // Validate EVERY source, not just [0] (round-2 item 5). An unknown source
  // (or a DO-NOT-USE feed the entity emit skips) is diagnosed — never silent:
  // the slice would resolve no documents from it at render time — and dropped
  // from the spec's feedIds. When NO source survives, the whole band keeps
  // the existing skip behavior: still a collection (feedIds verbatim), with
  // the diagnostics naming why it will query zero documents.
  const validIds: string[] = [];
  for (const id of feedIds) {
    if (id === "__media") {
      // Round-3 5b: the media-library sentinel is only meaningful as
      // sources[0] (where the grid path renders it — see above). In a later
      // position it is a KNOWN sentinel, not an unknown feed — named as such
      // and dropped from the collection's feed ids.
      opts.diagnostics?.push({
        kind: "skipped-feed",
        where,
        message: `band ${band.index} sources the __media media-library sentinel alongside feed sources — it only renders as sources[0]; dropped from the collection`,
      });
      continue;
    }
    const feed = feeds[id];
    const name = String(feed?.name ?? "");
    if (!feed) {
      opts.diagnostics?.push({
        kind: "skipped-feed",
        where,
        message: `band ${band.index} sources unknown feed "${id}" — the collection will resolve no documents from it`,
      });
    } else if (isSkippedFeed(name)) {
      opts.diagnostics?.push({
        kind: "skipped-feed",
        where,
        message: `band ${band.index} sources feed "${name}" (marked DO NOT USE — not migrated) — the collection will resolve no documents from it`,
      });
    } else {
      validIds.push(id);
    }
  }
  // Round-3 5a: duplicate sources (["feed-1","feed-1"]) must not duplicate
  // feed_ids — dedupe, keeping first-seen order.
  const keptIds = [...new Set(validIds.length ? validIds : feedIds)];
  const feedName = String(feeds[keptIds[0]!]?.name ?? "");
  // Collection is a container (decision B, round-2 item 2): a MAP mount riding
  // the feed band lifts onto the spec through the same widget triple
  // BluxSection uses — never treated as content, never dropped.
  const widget = liftMapWidget(band, opts);
  const cfg = item.sourceConfig ?? {};
  const filterTag = (cfg["filters"] as { tag?: unknown } | undefined)?.tag;
  const sort = cfg["sort"];
  // Real Blux sourceConfig carries `limit` as a STRING ('9','12','20','0');
  // '0'/0 means unlimited (omitted below, like NaN). `count` never occurs in
  // the fleet.
  const limit = Number(cfg["limit"]);
  const mediaRatio = cropRatioOf(cfg["mediaRatio"] ?? cfg["ratio"]);
  const { heading } = splitHeadingAndCells(band.root);
  const spec: BluxCollectionSpec = {
    slice: "BluxCollection",
    ...baseOf(band, opts),
    ...(heading ? { heading } : {}),
    entityType: feedEntityType(feedName),
    feedIds: keptIds,
    ...(typeof filterTag === "string" && filterTag ? { filterTag } : {}),
    ...(typeof sort === "string" && sort ? { sort } : {}),
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(mediaRatio ? { mediaRatio } : {}),
    layout: (item as { type?: unknown }).type === "slides" ? "carousel" : "grid",
    ...(cfg["scrollLoadMore"] === true ? { scrollLoadMore: true } : {}),
    ...(widget ?? {}),
  };
  return spec;
}

// -- helpers --
/** A raw custom-element feed-template mount: a div whose only substance is a
 * `data-exec` attr — no visible text, no media (fitHealthClub band 3:
 * `<div id="custom-element1" data-exec="custom_…"></div>`). It is the Blux
 * placeholder the collection replaces, so the emptyish guard must not read it
 * as content. A mount whose markup DOES carry visible content is real content. */
function isFeedTemplateMount(node: Node): boolean {
  return (
    node.kind === "raw" &&
    /\bdata-exec="custom_[a-f0-9_]+"/.test(node.html) &&
    !hasVisibleContent(node.html)
  );
}

/** Did this band lose its content to the feed-template drop? — its parsed
 * root is empty (just heading(s)/subtitle/empty-raw, no media and no populated
 * row). Local reimplementation of convert.ts's isEmptyish (not exported
 * there) — keep the two in sync. `ignore` (feed-band guard only) names nodes
 * that must not count as content: pure feed-template mounts and the page's
 * map mount (see bandOrCollection). */
function isEmptyish(root: Node, ignore?: (n: Node) => boolean): boolean {
  if (ignore?.(root)) return true;
  switch (root.kind) {
    case "heading":
    case "subtitle":
      return true;
    case "raw":
      return root.html.trim() === "";
    case "media":
    case "widget":
      return false;
    case "row": {
      // Round-3 5c: `ignore` applies through wrapper stacks too — a mount the
      // parser boxed in a stack inside a row cell is still just the mount.
      const cells = ignore
        ? root.cells.filter((c) => !isIgnoredSubtree(c.node, ignore))
        : root.cells;
      return cells.length === 0;
    }
    case "stack":
      return root.children.every((c) => isEmptyish(c, ignore));
    default:
      return false;
  }
}

/** Depth-first search for the mount node's raw html in the UNREWRITTEN band
 * tree (the predicate only ever matches `raw` nodes — see makeIsMapMount). */
function findMountHtml(node: Node, isMount: (n: Node) => boolean): string | undefined {
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

/** Diagnostic addressing (round-2 10a): `<pageUid>:<band>` when the caller
 * names the page, else the bare band index (option-less unit callers). */
function whereOf(band: Band, opts: BandToCatalogOptions): string {
  return opts.pageUid !== undefined ? `${opts.pageUid}:${band.index}` : String(band.index);
}

/** Decision-B mount recovery, shared by every container route (LocationMap →
 * Section, feed band → Collection, and — round 3 — Grid/Block): classifyBand
 * rewrote its COPY of the tree (the mount is an html-less widget node), but
 * `band.root` still holds the ORIGINAL raw mount — re-find it with the same
 * predicate. Returns the CatalogBase widget triple to spread onto the spec,
 * or undefined when no mount html is recoverable. */
function liftMapWidget(
  band: Band,
  opts: BandToCatalogOptions,
): { widgetKind: "map"; widgetHtml: string; mapConfig?: MapConfig } | undefined {
  const mountHtml = opts.isMapMount ? findMountHtml(band.root, opts.isMapMount) : undefined;
  if (mountHtml === undefined) return undefined;
  return {
    widgetKind: "map",
    widgetHtml: mountHtml,
    ...(opts.mapConfig ? { mapConfig: opts.mapConfig } : {}),
  };
}

/** Round-3 never-silent guard: classifyBand marked a mount (an html-less
 * `widget` node in its rewritten tree) but the lift recovered nothing — no
 * predicate, or one that no longer matches band.root. Without this the mount
 * would vanish with ZERO diagnostics (blockPayload serializes the widget node
 * as an empty div). */
function reportUnrecoveredMount(rewrittenRoot: Node, band: Band, opts: BandToCatalogOptions): void {
  if (!containsWidgetNode(rewrittenRoot)) return;
  opts.diagnostics?.push({
    kind: "dropped-widget",
    where: whereOf(band, opts),
    message: `band ${band.index} holds a widget mount but no mount html was recovered (no predicate, or one that no longer matches band.root) — the widget is dropped`,
  });
}

function containsWidgetNode(node: Node): boolean {
  if (node.kind === "widget") return true;
  const children =
    node.kind === "row"
      ? node.cells.map((c) => c.node)
      : node.kind === "stack"
        ? node.children
        : [];
  return children.some(containsWidgetNode);
}

/** Whether `ignore` swallows a whole subtree: the node itself, or a NON-EMPTY
 * stack of nothing but ignored subtrees (round-3 5c: the parser sometimes
 * boxes a mount in a wrapper stack inside a row cell). An empty stack still
 * counts as a cell, exactly as before. */
function isIgnoredSubtree(node: Node, ignore: (n: Node) => boolean): boolean {
  if (ignore(node)) return true;
  return (
    node.kind === "stack" &&
    node.children.length > 0 &&
    node.children.every((c) => isIgnoredSubtree(c, ignore))
  );
}
/** One carousel slide → a media cell. The caption html is wrapper-less in the
 * parser, so it is wrapped at the slide's own heading level; the subcaption
 * (the hero slide's location line) rides the cell body. */
function slideCell(s: CarouselSlide): CatalogCell {
  return {
    kind: "media",
    media: s.media,
    ...(s.caption ? { title: `<h${s.caption.level}>${s.caption.html}</h${s.caption.level}>` } : {}),
    ...(s.subcaption ? { bodyHtml: s.subcaption.html } : {}),
  };
}

/** Rich grid when the tree fits the cell→subgrid model; else the
 * content-preserving BluxBlock fallback (guard and builder agree by
 * construction — see cellDepthExceedsTwo). */
function gridOrBlock(root: Node, base: CatalogBaseFields): BluxGridSpec | BluxBlockSpec {
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
  headingRole?: string;
  cells: CatalogCell[];
} {
  const cells = nodeToCells(root).filter(
    (c) => c.title || c.bodyHtml || c.media || c.subgrid || c.embedHtml,
  );
  const hIdx = cells.findIndex(
    (c) => c.title && !c.bodyHtml && !c.media && !c.subgrid && !c.embedHtml,
  );
  const h = hIdx >= 0 ? cells[hIdx] : undefined;
  if (h)
    return {
      ...(h.title ? { heading: h.title } : {}),
      ...(h.titleRole ? { headingRole: h.titleRole } : {}),
      cells: cells.filter((_, i) => i !== hIdx),
    };
  return { cells };
}
// The two-field BluxMediaText slice keeps a RichText `body` (spec.ts), so its
// text half maps the cell's baked `bodyHtml` back onto that `body` field. Any
// txt-role-* wrappers in bodyHtml are intentionally flattened away here — a
// RichText field cannot carry them, so MediaText body role-fidelity is out of
// scope (this fix restores per-block roles for CELL bodies, not MediaText).
function pick(c: CatalogCell): { title?: string; body?: string } {
  return {
    ...(c.title ? { title: c.title } : {}),
    ...(c.bodyHtml ? { body: c.bodyHtml } : {}),
  };
}
