export type GridToken = {
  cols: number | "any";
  ratio?: number;
  // The grid's inter-cell spacing in px (Blux `grid-N-sM` / `data-spacing`).
  // This is a GAP, not a width — the cell's width comes from `cols`/`ratio`.
  spacing?: number;
  raw: string;
};

export type Media = {
  kind: "image" | "video";
  assetId: string;
  ext?: string;
  base?: string;
  // Intrinsic render sizing read off the rendered export (foreground images
  // only; band backgrounds and video carry none). `width` is the holder's inline
  // pixel width — the width the export actually renders that image at, whether a
  // 40px rule or an 800px+ photo — `aspect` the `.mediaRatio` `data-og-ratio`
  // (height as a % of width), `fit` its `background-size`. The render layer
  // treats `width` as advisory and caps it at 100% of the cell, so a graphic
  // keeps its true size instead of stretching, and a photo still fills.
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
