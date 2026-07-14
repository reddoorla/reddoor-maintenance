export type GridToken = {
  cols: number | "any";
  ratio?: number;
  // The grid's inter-cell spacing in px (Blux `grid-N-sM` / `data-spacing`).
  // This is a GAP, not a width — the cell's width comes from `cols`/`ratio`.
  spacing?: number;
  raw: string;
};

/** Video playback semantics read off the source `<video>` attributes (video
 * media only). Only attributes PRESENT in the export are set, so an absent field
 * means the attribute was absent — e.g. band 10's `<video controls playsinline>`
 * emits `{ controls: true, playsinline: true }` and NOT autoplay/loop/muted,
 * telling the render layer this is a user-initiated inline video, not a
 * background loop. */
export type VideoPlayback = {
  controls?: boolean;
  playsinline?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
};

export type Media = {
  kind: "image" | "video";
  assetId: string;
  ext?: string;
  base?: string;
  // Intrinsic render sizing read off the rendered export. `width` is the
  // foreground holder's inline pixel width (the width the export renders that
  // image at, whether a 40px rule or an 800px+ photo — foreground images only).
  // `aspect` is the `.mediaRatio` `data-og-ratio` (height as a % of width; also
  // read for foreground video). `fit` mirrors `background-size` — `contain`/
  // `cover` for a foreground graphic, or a band BACKGROUND's `cover`/`auto`
  // (`auto` = a native-size decorative accent, not a full-bleed cover).
  // `position` mirrors a band background's `background-position` (e.g.
  // "right bottom") so corner-anchored accents aren't centered. The render layer
  // treats `width` as advisory and caps it at 100% of the cell.
  width?: number;
  aspect?: number;
  fit?: "contain" | "cover" | "auto";
  position?: string;
  playback?: VideoPlayback;
};
// Forward-declared for plan 2's widget router. The parser does not emit
// `widget` nodes yet — map mounts currently parse to `raw`.
export type Widget = { type: "map" };

export type Node =
  | { kind: "row"; cells: Cell[] }
  | { kind: "stack"; children: Node[] }
  | { kind: "heading"; role?: string; level: number; html: string }
  | { kind: "body"; role?: string; html: string }
  | { kind: "subtitle"; role?: string; text: string }
  | { kind: "media"; media: Media }
  // Forward-declared for plan 2's widget router. The parser does not emit
  // `widget` nodes yet — map mounts currently parse to `raw`.
  | { kind: "widget"; widget: Widget }
  | { kind: "raw"; html: string };

export type Cell = { token: GridToken; node: Node };
export type Band = {
  index: number; // the source page-block-N number (not necessarily the array position)
  background?: Media;
  root: Node;
};
