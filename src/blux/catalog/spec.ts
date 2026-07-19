import type { Media } from "../grid/types.js";

/** A rich-text run kept as raw HTML — emit turns it into a `{__richtext_html}`
 * marker; the parser already produces HTML for heading/body nodes. */
export type CatalogRichText = string;

/** One catalog cell — the structural unit the Plan-2 `BluxCell` renders. Only
 * the skeleton subset is modelled: text, media, and one nested subgrid level.
 * `kind` mirrors the Prismic Select ("text" | "media" | "subgrid" here). */
export type CatalogCell = {
  kind: "text" | "media" | "subgrid";
  title?: CatalogRichText;
  body?: CatalogRichText;
  media?: Media;
  mediaRatio?: string;
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

/** The catalog classify target. One member for the skeleton; Plan 4 adds the
 * rest (Grid/Gallery/Carousel/Media/MediaText/Embed/Table/Collection + BluxBlock). */
export type CatalogSpec = BluxSectionSpec;

export type CatalogKind = CatalogSpec["slice"];
