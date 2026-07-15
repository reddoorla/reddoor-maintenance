// Render-faithful presentation manifest (plan 5). Transforms the source
// node tree (src/blux/grid/types.ts `Node`) and the classified `SliceSpec[]`
// into `blux-presentation.json`, the render-side contract the-pointe's
// Svelte layer loads (src/lib/blux/presentation.ts — that file is the fixed
// target; these mirror types must match it exactly). Media/style/map are
// resolved via injected `deps` so this builder stays pure and offline.
import type {
  Media,
  Node,
  GridToken as SrcToken,
  SliceSpec,
  VideoPlayback,
} from "../grid/index.js";
import type { BlockDefaults } from "./block-styles.js";

// ---------------------------------------------------------------------------
// Render-side mirror types (must match the-pointe's src/lib/blux/presentation.ts)
// ---------------------------------------------------------------------------

export type RenderMedia = {
  kind: "image" | "video";
  url: string;
  alt?: string;
  // Intrinsic sizing carried from the source. `width`/`aspect` size a foreground
  // graphic (capped to its cell) so rules/logos keep their true size. `fit` +
  // `position` carry a band background's `background-size`/`-position` so a
  // corner-anchored `auto` accent isn't centered full-bleed. `playback` carries a
  // video's source `<video>` attributes. Mirrors the-pointe's src/lib/blux/presentation.ts.
  width?: number;
  aspect?: number;
  fit?: "contain" | "cover" | "auto";
  position?: string;
  /** The source holder's inline min-height (e.g. "80vh" on slider slides), so
   * a cover-frame carousel reserves the original's height. */
  minHeight?: string;
  playback?: VideoPlayback;
};

export type RenderToken = { cols: number | "any"; ratio?: number; spacing?: number };

export type RenderNode =
  | { kind: "row"; cells: RenderCell[]; style?: Record<string, string> }
  | { kind: "stack"; children: RenderNode[]; style?: Record<string, string> }
  | {
      kind: "heading";
      level: number;
      html: string;
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
    }
  | {
      kind: "body";
      html: string;
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
    }
  | {
      kind: "subtitle";
      text: string;
      role?: string;
      /** Inline deviations the export carries on the text leaf (color, padding)
       * plus decoded margin utilities (margin-20r → margin-right:20%). The
       * margin-right percentage is desktop-only in the source (reset ≤800px) —
       * the render scopes it to md+. */
      style?: Record<string, string>;
    }
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
export type MapToggle = { label: string; layers: string[]; panelIndex: number };
export type MapRenderConfig = {
  mid: string;
  layers: MapLayer[];
  toggles: MapToggle[];
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
  defaultToggle?: number;
};

export type BandPresentation = {
  style?: Record<string, string>;
  background?: RenderMedia;
  tree?: RenderNode;
  split?: { mediaSide: "left" | "right"; ratio: number; media: RenderMedia; text: RenderNode };
  gallery?: RenderMedia[];
  /** Carousel payload: the band is a source slider (.caslider). Caption TEXT
   * lives in the page doc's items (Prismic-editable); the manifest carries the
   * media and the caption's role metadata. `columns` = slides visible at once
   * (source data-columns). */
  carousel?: {
    slides: {
      media: RenderMedia;
      caption?: { level?: number; role?: string };
    }[];
    columns?: number;
  };
  media?: RenderMedia;
  map?: MapRenderConfig;
  /** Hero/TitleBand heading textN role + h-level and subtitle role, so the
   * render applies the right display font/tag. The text itself is the Prismic
   * page-doc string; this is presentation metadata only. */
  text?: { headingRole?: string; headingLevel?: number; subtitleRole?: string };
};

export type Presentation = { bands: Record<string, BandPresentation> };

export type PresentationDeps = {
  resolveMedia: (media: Media) => RenderMedia | null;
  styleFor: (index: number) => Record<string, string> | undefined;
  /** The `.blocksNcontainer` class defaults for a band's `blockClass`
   * (see `blockClassDefaults`) — filled into `BandPresentation.style` only
   * where the block's own styles omit the key. */
  defaultsFor: (blockClass: string) => BlockDefaults | undefined;
  map?: MapRenderConfig | null;
};

// ---------------------------------------------------------------------------
// Node-tree serializer: source Node → RenderNode
// ---------------------------------------------------------------------------

/** Drop the source-only `raw` field from a grid token; keep only cols/ratio/spacing. */
function renderToken(t: SrcToken): RenderToken {
  return {
    cols: t.cols,
    ...(t.ratio !== undefined ? { ratio: t.ratio } : {}),
    ...(t.spacing !== undefined ? { spacing: t.spacing } : {}),
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
      return { kind: "row", cells, ...(node.style ? { style: node.style } : {}) };
    }
    case "stack": {
      const children: RenderNode[] = [];
      for (const c of node.children) {
        const rn = renderNode(c, resolve);
        if (rn) children.push(rn);
      }
      return { kind: "stack", children, ...(node.style ? { style: node.style } : {}) };
    }
    case "heading":
      return {
        kind: "heading",
        level: node.level,
        html: node.html,
        ...(node.role ? { role: node.role } : {}),
        ...(node.style ? { style: node.style } : {}),
      };
    case "body":
      return {
        kind: "body",
        html: node.html,
        ...(node.role ? { role: node.role } : {}),
        ...(node.style ? { style: node.style } : {}),
      };
    case "subtitle":
      return {
        kind: "subtitle",
        text: node.text,
        ...(node.role ? { role: node.role } : {}),
        ...(node.style ? { style: node.style } : {}),
      };
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
export function hasMapWidget(node: Node): boolean {
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
    // Class-default padding/max-width — for EVERY slice type (TitleBand/Hero
    // bands need their band padding too), filling only the keys the block's
    // own styles omit. The trigger is "no `_contentPadding` in the block's
    // styles", never "no style record" (a block can style other things and
    // still rely on the class padding). `_contentPaddingMobile` only ever
    // pairs with a filled default: a block's own padding has no mobile twin.
    const defaults = spec.blockClass ? deps.defaultsFor(spec.blockClass) : undefined;
    if (defaults) {
      const own = bp.style ?? {};
      const fill: Record<string, string> = {};
      if (own["_contentPadding"] === undefined && defaults.padding) {
        fill["_contentPadding"] = defaults.padding;
        if (defaults.mobilePadding) fill["_contentPaddingMobile"] = defaults.mobilePadding;
      }
      if (own["_max-content-width"] === undefined && defaults.maxWidth) {
        fill["_max-content-width"] = defaults.maxWidth;
      }
      // Copy, never mutate — the styleFor record may be shared/cached.
      if (Object.keys(fill).length) bp.style = { ...own, ...fill };
    }
    if (spec.background) {
      const bg = deps.resolveMedia(spec.background);
      if (bg) bp.background = bg;
    }

    switch (spec.slice) {
      case "Hero":
      case "TitleBand": {
        // Text lives in the page doc; carry only the role/level metadata so the
        // render picks the right display font + heading tag.
        const meta = {
          ...(spec.headingRole ? { headingRole: spec.headingRole } : {}),
          ...(spec.headingLevel !== undefined ? { headingLevel: spec.headingLevel } : {}),
          ...(spec.subtitleRole ? { subtitleRole: spec.subtitleRole } : {}),
        };
        if (Object.keys(meta).length) bp.text = meta;
        break;
      }
      case "RichText":
        break; // content is in the page doc
      case "Gallery": {
        const g = spec.media.map(deps.resolveMedia).filter((m): m is RenderMedia => m !== null);
        if (g.length) bp.gallery = g;
        break;
      }
      case "Carousel": {
        // Caption TEXT lives in the page doc's items; only its role metadata
        // rides the manifest. An unresolved media TRUNCATES the slide list —
        // splicing it out would shift later slides onto the wrong page-doc
        // caption (the render zips items↔slides by index). Either way the
        // count shrink trips validateLayout's media-dropped finding.
        const slides: { media: RenderMedia; caption?: { level?: number; role?: string } }[] = [];
        for (const s of spec.slides) {
          const media = deps.resolveMedia(s.media);
          if (!media) break;
          const slide: { media: RenderMedia; caption?: { level?: number; role?: string } } = {
            media,
          };
          if (s.caption) {
            const caption: { level?: number; role?: string } = { level: s.caption.level };
            if (s.caption.role !== undefined) caption.role = s.caption.role;
            slide.caption = caption;
          }
          slides.push(slide);
        }
        if (slides.length > 0) {
          bp.carousel = spec.columns !== undefined ? { slides, columns: spec.columns } : { slides };
        }
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
