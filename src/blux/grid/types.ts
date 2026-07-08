export type GridToken = {
  cols: number | "any";
  ratio?: number;
  sized?: number;
  raw: string;
};

export type Media = { kind: "image" | "video"; assetId: string; ext?: string };
export type Widget = { type: "map" };

export type Node =
  | { kind: "row"; cells: Cell[] }
  | { kind: "stack"; children: Node[] }
  | { kind: "heading"; role?: string; level: number; html: string }
  | { kind: "body"; role?: string; html: string }
  | { kind: "subtitle"; role?: string; text: string }
  | { kind: "media"; media: Media }
  | { kind: "widget"; widget: Widget }
  | { kind: "raw"; html: string };

export type Cell = { token: GridToken; node: Node };
export type Band = { index: number; background?: Media; root: Node };
