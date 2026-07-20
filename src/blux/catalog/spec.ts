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
  subgrid?: CatalogCell[];
};

/** A container band → the Plan-2 `blux_section` slice. `index` is the slice-zone
 * position (kept for parity with SliceSpec + future manifest-free ordering). */
export type BluxSectionSpec = {
  slice: "BluxSection";
  index: number;
  background?: Media;
  backgroundColor?: string;
  heading?: CatalogRichText;
  cells: CatalogCell[];
};

type CatalogBase = {
  index: number;
  background?: Media;
  backgroundColor?: string;
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
  | BluxBlockSpec;

export type CatalogKind = CatalogSpec["slice"];
