import type { Media, Node } from "./types.js";

/** Every SliceSpec carries the band's slice-zone index and (optional) band
 * background, so the runtime can line slices up with the emit outputs and render
 * the background band exactly as today. */
type SpecBase = { index: number; background?: Media };

/** A full-bleed band with overlay text (structural signal: a band `background`
 * plus an overlay heading, no grid row, no foreground media). */
export type HeroSpec = SpecBase & {
  slice: "Hero";
  heading?: string;
  subtitle?: string;
  body?: string;
};

/** A centered title band: heading (+ optional eyebrow subtitle), no media. */
export type TitleBandSpec = SpecBase & {
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

/** A single full-width media node, no text. */
export type MediaFullSpec = SpecBase & { slice: "MediaFull"; media: Media };

/** Only rich text (one body node, no media / rows). */
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
  | MediaFullSpec
  | RichTextSpec
  | VideoFeatureSpec
  | LocationMapSpec
  | GridSpec;

export type SliceKind = SliceSpec["slice"];
