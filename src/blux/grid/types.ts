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
  /** The holder's inline min-height (e.g. "80vh" on slider slides), so a
   * cover-frame render reserves the original's height. */
  minHeight?: string;
  playback?: VideoPlayback;
};
// Forward-declared for plan 2's widget router. The parser does not emit
// `widget` nodes yet — map mounts currently parse to `raw`.
export type Widget = { type: "map" };

export type Node =
  | {
      kind: "row";
      cells: Cell[];
      /** Present when the source grid is a `.caslider` — a JS slider showing
       * `columns` slides at a time (data-columns). The signature does NOT
       * encode this (classification is guarded by unit tests instead) so
       * Grid-fallback drift comparisons stay stable. */
      slider?: { columns?: number };
      /** Inline deviations inherited from a peeled container wrapper (a Blux
       * "card": a `.blocks0` whose inline `background-color` the layout wrappers
       * would otherwise drop). Same shape as a text leaf's `style`; currently
       * only `background-color`. Distinct from `Band.background` (a Media image). */
      style?: Record<string, string>;
    }
  | { kind: "stack"; children: Node[]; style?: Record<string, string> }
  | {
      kind: "heading";
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
      level: number;
      html: string;
    }
  | {
      kind: "body";
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
      html: string;
    }
  | {
      kind: "subtitle";
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
      text: string;
    }
  | { kind: "media"; media: Media }
  // Forward-declared for plan 2's widget router. The parser does not emit
  // `widget` nodes yet — map mounts currently parse to `raw`.
  | { kind: "widget"; widget: Widget }
  | { kind: "raw"; html: string };

export type Cell = { token: GridToken; node: Node };
export type Band = {
  index: number; // the source page-block-N number (not necessarily the array position)
  /** The band wrapper's blocksN class (e.g. "blocks0") — resolves which
   * .blocksNcontainer class defaults apply when the block's own styles
   * omit padding/max-width. From the HTML (site.json items[].class is
   * unreliable — null for 7/16 the-pointe blocks). */
  blockClass?: string;
  background?: Media;
  root: Node;
};
