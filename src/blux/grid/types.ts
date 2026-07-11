export type GridToken = {
  cols: number | "any";
  ratio?: number;
  sized?: number;
  raw: string;
};

export type Media = { kind: "image" | "video"; assetId: string; ext?: string; base?: string };
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
