// Render-faithful presentation manifest (plan 5). Transforms the source
// node tree (src/blux/grid/types.ts `Node`) and the classified `SliceSpec[]`
// into `blux-presentation.json`, the render-side contract the-pointe's
// Svelte layer loads (src/lib/blux/presentation.ts — that file is the fixed
// target; these mirror types must match it exactly). Media/style/map are
// resolved via injected `deps` so this builder stays pure and offline.
import type { Media, Node, GridToken as SrcToken, SliceSpec } from "../grid/index.js";

// ---------------------------------------------------------------------------
// Render-side mirror types (must match the-pointe's src/lib/blux/presentation.ts)
// ---------------------------------------------------------------------------

export type RenderMedia = { kind: "image" | "video"; url: string; alt?: string };

export type RenderToken = { cols: number | "any"; ratio?: number; sized?: number };

export type RenderNode =
  | { kind: "row"; cells: RenderCell[] }
  | { kind: "stack"; children: RenderNode[] }
  | { kind: "heading"; level: number; html: string; role?: string }
  | { kind: "body"; html: string; role?: string }
  | { kind: "subtitle"; text: string; role?: string }
  | { kind: "media"; media: RenderMedia }
  | { kind: "raw"; html: string }
  | { kind: "widget"; widget: { type: "map" } };

export type RenderCell = { token: RenderToken; node: RenderNode };

export type MapLayer = {
  name: string;
  lid: string;
  initiallyVisible: boolean;
  preserveViewport: boolean;
};
export type MapToggle = { label: string; layers: string[] };
export type MapRenderConfig = {
  mid: string;
  layers: MapLayer[];
  toggles: MapToggle[];
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
};

export type BandPresentation = {
  style?: Record<string, string>;
  background?: RenderMedia;
  tree?: RenderNode;
  split?: { mediaSide: "left" | "right"; ratio: number; media: RenderMedia; text: RenderNode };
  gallery?: RenderMedia[];
  media?: RenderMedia;
  map?: MapRenderConfig;
};

export type Presentation = { bands: Record<string, BandPresentation> };

export type PresentationDeps = {
  resolveMedia: (media: Media) => RenderMedia | null;
  styleFor: (index: number) => Record<string, string> | undefined;
  map?: MapRenderConfig | null;
};

// ---------------------------------------------------------------------------
// Node-tree serializer: source Node → RenderNode
// ---------------------------------------------------------------------------

/** Drop the source-only `raw` field from a grid token; keep only cols/ratio/sized. */
function renderToken(t: SrcToken): RenderToken {
  return {
    cols: t.cols,
    ...(t.ratio !== undefined ? { ratio: t.ratio } : {}),
    ...(t.sized !== undefined ? { sized: t.sized } : {}),
  };
}

/** Recursively serialize a source Node → RenderNode: resolve media (dropping
 * unresolved media nodes), strip token.raw. Never mutates the input. */
function renderNode(node: Node, resolve: PresentationDeps["resolveMedia"]): RenderNode | null {
  switch (node.kind) {
    case "row": {
      const cells: RenderCell[] = [];
      for (const c of node.cells) {
        const rn = renderNode(c.node, resolve);
        if (rn) cells.push({ token: renderToken(c.token), node: rn });
      }
      return { kind: "row", cells };
    }
    case "stack": {
      const children: RenderNode[] = [];
      for (const c of node.children) {
        const rn = renderNode(c, resolve);
        if (rn) children.push(rn);
      }
      return { kind: "stack", children };
    }
    case "heading":
      return {
        kind: "heading",
        level: node.level,
        html: node.html,
        ...(node.role ? { role: node.role } : {}),
      };
    case "body":
      return { kind: "body", html: node.html, ...(node.role ? { role: node.role } : {}) };
    case "subtitle":
      return { kind: "subtitle", text: node.text, ...(node.role ? { role: node.role } : {}) };
    case "media": {
      const m = resolve(node.media);
      return m ? { kind: "media", media: m } : null; // drop unresolved media
    }
    case "raw":
      return { kind: "raw", html: node.html };
    case "widget":
      return { kind: "widget", widget: node.widget };
  }
}

/** Does a (source) node tree contain a map widget anywhere? */
function hasMapWidget(node: Node): boolean {
  if (node.kind === "widget") return node.widget.type === "map";
  if (node.kind === "row") return node.cells.some((c) => hasMapWidget(c.node));
  if (node.kind === "stack") return node.children.some(hasMapWidget);
  return false;
}

// ---------------------------------------------------------------------------
// Per-variant builder: SliceSpec[] → Presentation
// ---------------------------------------------------------------------------

export function buildPresentation(specs: SliceSpec[], deps: PresentationDeps): Presentation {
  const bands: Record<string, BandPresentation> = {};
  for (const spec of specs) {
    const bp: BandPresentation = {};
    const style = deps.styleFor(spec.index);
    if (style) bp.style = style;
    if (spec.background) {
      const bg = deps.resolveMedia(spec.background);
      if (bg) bp.background = bg;
    }

    switch (spec.slice) {
      case "Hero":
      case "TitleBand":
        break; // text is in the page doc; only style/background here
      case "RichText":
        break; // content is in the page doc
      case "Gallery": {
        const g = spec.media.map(deps.resolveMedia).filter((m): m is RenderMedia => m !== null);
        if (g.length) bp.gallery = g;
        break;
      }
      case "MediaFull":
      case "VideoFeature": {
        const m = deps.resolveMedia(spec.media);
        if (m) bp.media = m;
        break;
      }
      case "SplitFeature": {
        const media = deps.resolveMedia(spec.media);
        const text = renderNode(spec.text, deps.resolveMedia);
        if (media && text) bp.split = { mediaSide: spec.mediaSide, ratio: spec.ratio, media, text };
        break;
      }
      case "LocationMap":
        if (deps.map) bp.map = deps.map;
        break;
      case "Grid": {
        const tree = renderNode(spec.root, deps.resolveMedia);
        if (tree) bp.tree = tree;
        // Co-located map (widget:map inside the tree): attach the map config too.
        if (deps.map && hasMapWidget(spec.root)) bp.map = deps.map;
        break;
      }
    }
    bands[String(spec.index)] = bp;
  }
  return { bands };
}
