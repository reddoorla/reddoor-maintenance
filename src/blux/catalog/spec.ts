import type { MapConfig } from "../grid/extract-map.js";
import type { Media } from "../grid/types.js";

/** A rich-text run kept as raw HTML — emit turns it into a `{__richtext_html}`
 * marker; the parser already produces HTML for heading/body nodes. */
export type CatalogRichText = string;

/** One catalog cell — the structural unit the Plan-2 `BluxCell` renders.
 * `kind` mirrors the Prismic Select ("text" | "media" | "embed" | "subgrid"). */
export type CatalogCell = {
  kind: "text" | "media" | "embed" | "subgrid";
  title?: CatalogRichText;
  body?: CatalogRichText;
  media?: Media;
  mediaRatio?: string;
  embedHtml?: string;
  // --- visual-fidelity fields (Blux catalog visual layer) ---
  width?: string;
  spacing?: number;
  cover?: boolean;
  valign?: boolean;
  backgroundColor?: string;
  contentPadding?: string;
  titleRole?: string;
  bodyRole?: string;
  subgrid?: CatalogCell[];
};

/** Fields shared by every catalog spec. `index` is the slice-zone position
 * (kept for parity with SliceSpec + future manifest-free ordering).
 * Decision-B widget routing (plan 4b, round 3): ANY spec can carry a custom
 * mount (the map) as a widget — the ORIGINAL mount html rides `widgetHtml`
 * (pristine — sanitize is emit's concern) with `widgetKind` naming it; for
 * maps the extracted `MapConfig` rides along so emit can inline it into the
 * document. The triple lives HERE (round 3) because every real fleet map band
 * holds the mount PLUS panel rows, so it routes Grid/Block — not just the
 * Section/Collection containers. */
export type CatalogBase = {
  index: number;
  background?: Media;
  backgroundColor?: string;
  // --- band-level visual-fidelity fields (Blux catalog visual layer) ---
  minHeight?: string;
  contentPadding?: string;
  contentPaddingMobile?: string;
  maxContentWidth?: string;
  verticalAlign?: string;
  textAlign?: string;
  columnWidth?: string;
  columnSide?: string;
  headingRole?: string;
  widgetKind?: string;
  widgetHtml?: string;
  mapConfig?: MapConfig;
};

/** A container band → the Plan-2 `blux_section` slice. A band whose sole
 * content is a custom mount becomes a section carrying the widget triple
 * (see CatalogBase) with no cells. */
export type BluxSectionSpec = CatalogBase & {
  slice: "BluxSection";
  heading?: CatalogRichText;
  cells: CatalogCell[];
};

export type BluxGridSpec = CatalogBase & {
  slice: "BluxGrid";
  heading?: CatalogRichText;
  columns?: number;
  cells: CatalogCell[];
};
export type BluxGallerySpec = CatalogBase & {
  slice: "BluxGallery";
  heading?: CatalogRichText;
  cells: CatalogCell[]; // all kind:"media"
};
export type BluxCarouselSpec = CatalogBase & {
  slice: "BluxCarousel";
  heading?: CatalogRichText;
  columnsVisible?: number;
  cells: CatalogCell[];
};
export type BluxMediaSpec = CatalogBase & {
  slice: "BluxMedia";
  media: Media;
  caption?: CatalogRichText;
};
export type BluxMediaTextSpec = CatalogBase & {
  slice: "BluxMediaText";
  mediaSide: "left" | "right";
  layoutRatio?: number;
  media: Media;
  title?: CatalogRichText;
  body?: CatalogRichText;
};
/** A feed-backed band → the `blux_collection` query-spec slice (spec §6 row 5,
 * §7 rule 1). The slice carries NO cells — the starter resolves the mapped
 * entity documents at load time and renders them through the tagFilter DSL.
 * Collection is a CONTAINER (decision B): a widget mount can ride it exactly
 * like BluxSection (the CatalogBase widget triple, emitted through the same
 * widgetFields path). */
export type BluxCollectionSpec = CatalogBase & {
  slice: "BluxCollection";
  heading?: CatalogRichText;
  entityType: string; // mapped Prismic type the renderer queries
  feedIds: string[]; // original Blux feed ids (traceability)
  filterTag?: string; // tagFilter DSL expression
  sort?: string;
  limit?: number;
  mediaRatio?: string;
  layout: "grid" | "carousel";
  scrollLoadMore?: boolean;
};

/** Content-preserving fallback: the serialized node tree (Prismic can't nest
 * deeper than cell→subgrid). `payload` is a `{tag,children,html,image,style}`
 * tree the Plan-2 BluxBlock slice renders recursively. */
export type BluxBlockSpec = CatalogBase & {
  slice: "BluxBlock";
  payload: BlockNode;
  /** Every Media under the source subtree. The payload inlines them as CDN
   * urls, but emit still needs the Media list so the assets upload (payload
   * urls stay CDN until the 4d migrate-time rewrite — runMigration's
   * assetUrlByCdn is the map for it). */
  media: Media[];
};

/** The serialized-tree shape BluxBlock renders (mirror of starter
 * src/lib/slices/BluxBlock/node.ts BluxNode). */
export type BlockNode = {
  tag?: string;
  html?: string;
  image?: { url: string; alt?: string };
  style?: Record<string, string>;
  className?: string;
  children?: BlockNode[];
};

/** The catalog classify target: every breadth slice + the BluxBlock fallback. */
export type CatalogSpec =
  | BluxSectionSpec
  | BluxGridSpec
  | BluxGallerySpec
  | BluxCarouselSpec
  | BluxMediaSpec
  | BluxMediaTextSpec
  | BluxCollectionSpec
  | BluxBlockSpec;

export type CatalogKind = CatalogSpec["slice"];
