import type { Media, Node } from "./types.js";

/** Every SliceSpec carries the band's slice-zone index and (optional) band
 * background, so the runtime can line slices up with the emit outputs and render
 * the background band exactly as today. `blockClass` rides along from
 * `Band.blockClass` so emit can resolve the `.blocksNcontainer` class defaults
 * (padding/max-width) the block's own styles omit. */
type SpecBase = { index: number; blockClass?: string; background?: Media };

/** The source heading's textN role + h-level and the subtitle's role, so the
 * render applies the right display font/tag. Carried ALONGSIDE the plain-string
 * heading/subtitle (which stay the Prismic-editable page-doc text) — this is
 * presentation metadata only. */
type TextRoleMeta = {
  headingRole?: string;
  headingLevel?: number;
  subtitleRole?: string;
};

/** A full-bleed band with overlay text (structural signal: a band `background`
 * plus an overlay heading, no grid row, no foreground media). */
export type HeroSpec = SpecBase &
  TextRoleMeta & {
    slice: "Hero";
    heading?: string;
    subtitle?: string;
    body?: string;
  };

/** A centered title band: heading (+ optional eyebrow subtitle), no media. */
export type TitleBandSpec = SpecBase &
  TextRoleMeta & {
    slice: "TitleBand";
    heading: string;
    subtitle?: string;
  };

/** One row, exactly two cells: one pure-media, one text-bearing. `ratio` is the
 * media cell's grid share (e.g. 40 for `grid-2-r40`); `mediaSide` says which side.
 * The text side may itself contain nested media (band 1 does), so renderers must
 * render `text` recursively, not as prose only. */
export type SplitFeatureSpec = SpecBase & {
  slice: "SplitFeature";
  ratio: number;
  mediaSide: "left" | "right";
  media: Media;
  text: Node;
};

/** One row whose every cell is a single media node (≥2 cells). */
export type GallerySpec = SpecBase & { slice: "Gallery"; media: Media[] };

/** One slider slide: its media plus the caption text-block nested inside the
 * holder (band-8 archetype: a single h5.block-title per slide). */
export type CarouselSlide = {
  media: Media;
  caption?: { html: string; level: number; role?: string };
};

/** A source slider (.caslider): media slides shown `columns` at a time.
 * The export encodes no autoplay/duration/dots — deliberately absent. */
export type CarouselSpec = SpecBase & {
  slice: "Carousel";
  slides: CarouselSlide[];
  columns?: number;
};

/** A single full-width media node, no text. */
export type MediaFullSpec = SpecBase & { slice: "MediaFull"; media: Media };

/** Only rich text: the band's body node(s), joined with `\n` (no media / rows /
 * headings / subtitles). */
export type RichTextSpec = SpecBase & { slice: "RichText"; html: string };

/** A band whose sole content is one video. */
export type VideoFeatureSpec = SpecBase & { slice: "VideoFeature"; media: Media };

/** A band whose dominant content is the interactive map widget. Config
 * (mid/lids/style/center) is extracted later (plan 4, `extract-map.ts`). */
export type LocationMapSpec = SpecBase & { slice: "LocationMap" };

/** The render-faithful fallback: the (widget-rewritten) node tree, rendered
 * recursively by plan-3's `Grid.svelte`. */
export type GridSpec = SpecBase & { slice: "Grid"; root: Node };

export type SliceSpec =
  | HeroSpec
  | TitleBandSpec
  | SplitFeatureSpec
  | GallerySpec
  | CarouselSpec
  | MediaFullSpec
  | RichTextSpec
  | VideoFeatureSpec
  | LocationMapSpec
  | GridSpec;

export type SliceKind = SliceSpec["slice"];
