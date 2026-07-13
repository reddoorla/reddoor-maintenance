export type GridToken = {
  cols: number | "any";
  ratio?: number;
  sized?: number;
  raw: string;
};

export type Media = {
  kind: "image" | "video";
  assetId: string;
  ext?: string;
  base?: string;
  // Intrinsic render sizing read off the rendered export (foreground images
  // only; band backgrounds and video carry none). `width` is the holder's inline
  // pixel width, `aspect` the `.mediaRatio` `data-og-ratio` (height as a % of
  // width), `fit` its `background-size`. Blux uses small graphics as rules/logos
  // whose intrinsic width must be preserved, not stretched full-bleed.
  width?: number;
  aspect?: number;
  fit?: "contain" | "cover";
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
