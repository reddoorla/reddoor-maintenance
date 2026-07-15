import type { Band, Cell, Media, Node, Widget } from "./types.js";
import type { CarouselSlide, CarouselSpec, SliceSpec } from "./slice-spec.js";
import { blockPlainText } from "./leaf.js";

/** Depth-first collect of every `media` node's `Media` in a subtree. */
export function collectMedia(node: Node): Media[] {
  switch (node.kind) {
    case "media":
      return [node.media];
    case "row":
      return node.cells.flatMap((c) => collectMedia(c.node));
    case "stack":
      return node.children.flatMap(collectMedia);
    case "heading":
    case "body":
    case "subtitle":
    case "widget":
    case "raw":
      return [];
  }
}

/** Depth-first collect of text nodes (heading/body/subtitle). */
export function collectText(node: Node): Node[] {
  switch (node.kind) {
    case "heading":
    case "body":
    case "subtitle":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectText(c.node));
    case "stack":
      return node.children.flatMap(collectText);
    case "media":
    case "widget":
    case "raw":
      return [];
  }
}

/** Depth-first collect of every widget in a subtree. */
export function collectWidgets(node: Node): Widget[] {
  switch (node.kind) {
    case "widget":
      return [node.widget];
    case "row":
      return node.cells.flatMap((c) => collectWidgets(c.node));
    case "stack":
      return node.children.flatMap(collectWidgets);
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "raw":
      return [];
  }
}

/** Depth-first collect of every `raw` node in a subtree. */
function collectRaws(node: Node): Node[] {
  switch (node.kind) {
    case "raw":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectRaws(c.node));
    case "stack":
      return node.children.flatMap(collectRaws);
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
      return [];
  }
}

/** The root row NODE, or null when the root is not a single row. A `stack`
 * whose only child is a row also counts (Blux wraps rows in holders). */
export function topRowNode(node: Node): Extract<Node, { kind: "row" }> | null {
  if (node.kind === "row") return node;
  if (node.kind === "stack" && node.children.length === 1) {
    const [only] = node.children;
    if (only && only.kind === "row") return only;
  }
  return null;
}

/** The cells of the root row, or null when the root is not a single row. */
export function topRow(node: Node): Cell[] | null {
  return topRowNode(node)?.cells ?? null;
}

/** A `raw` node carrying no rendered text or nested block — the shape a
 * client-injected mount (e.g. the map container) parses to. */
export function isEmptyRaw(node: Node): boolean {
  if (node.kind !== "raw") return false;
  const text = node.html.replace(/<[^>]*>/g, "").trim();
  return text.length === 0;
}

/** Options for the classifier. `isMapMount` is injected by plan 4
 * (`extract-map.ts`); by default nothing is recognized as a map. */
export type ClassifyOptions = {
  isMapMount?: (node: Node) => boolean;
};

/** The band's slice-zone base carried onto every spec (conditional spread keeps
 * `blockClass`/`background` absent, not `undefined`, under
 * exactOptionalPropertyTypes). */
function base(band: Band): { index: number; blockClass?: string; background?: Media } {
  return {
    index: band.index,
    ...(band.blockClass ? { blockClass: band.blockClass } : {}),
    ...(band.background ? { background: band.background } : {}),
  };
}

/** Plain text of a heading/subtitle/body node. Hard line breaks (Blux `<br>`)
 * survive as newlines so the render layer can split a display title back into
 * lines; all other tags and source whitespace collapse to single spaces. */
function nodeText(node: Node): string {
  switch (node.kind) {
    case "heading":
    case "body":
      // Raw markup — `<br>` → newline, other tags + source formatting → spaces.
      return blockPlainText(node.html);
    case "subtitle":
      // Already normalized at parse via blockPlainText (entities decoded, hard
      // breaks as newlines, source whitespace collapsed) — pass it through.
      return node.text.trim();
    case "row":
    case "stack":
    case "media":
    case "widget":
    case "raw":
      return "";
  }
}

/** The single media of a pure-media cell, or null if the cell isn't pure media. */
function pureCellMedia(cell: Cell): Media | null {
  return cell.node.kind === "media" ? cell.node.media : null;
}

/** TitleBand/Hero presentation metadata: the heading's textN role + h-level and
 * the subtitle's role. Carried alongside the plain-string text (page-doc) so the
 * render applies the right display font/tag — band 15's script accent heading
 * (`h2.text11`) must not render like a plain `text5` title. */
function textRoleMeta(
  heading: Node | undefined,
  subtitle: Node | undefined,
): { headingRole?: string; headingLevel?: number; subtitleRole?: string } {
  return {
    ...(heading?.kind === "heading" && heading.role ? { headingRole: heading.role } : {}),
    ...(heading?.kind === "heading" ? { headingLevel: heading.level } : {}),
    ...(subtitle?.kind === "subtitle" && subtitle.role ? { subtitleRole: subtitle.role } : {}),
  };
}

/** A cell's effective column share as a percentage, from its grid token.
 *
 * Width comes from the explicit `ratio` (`grid-2-r60` → 60) or, absent that,
 * an equal split of the column count. `spacing` (the `s` suffix) is a gap, not
 * a width, so it never factors in here. The `"any"` → 50 fallback assumes a
 * 2-cell row — the only shape that reaches here today (SplitFeature requires
 * exactly two cells); a bare-`any` cell in a wider row would need real division. */
function cellRatio(cell: Cell): number {
  const t = cell.token;
  if (typeof t.ratio === "number") return t.ratio;
  if (t.cols === "any") return 50;
  return Math.round(100 / t.cols);
}

/** The carousel slides of a slider row, or null when any cell isn't a media
 * slide. A slide is a bare `media` cell or a `stack[media, heading]` captioned
 * slide (the band-8 archetype); ≥2 qualifying slides required. */
function carouselSlides(cells: Cell[]): CarouselSlide[] | null {
  const out: CarouselSlide[] = [];
  for (const c of cells) {
    const n = c.node;
    if (n.kind === "media") {
      out.push({ media: n.media });
      continue;
    }
    if (n.kind === "stack" && n.children.length === 2) {
      const [m, h] = n.children;
      if (m?.kind === "media" && h?.kind === "heading") {
        out.push({
          media: m.media,
          caption: { html: h.html, level: h.level, ...(h.role ? { role: h.role } : {}) },
        });
        continue;
      }
    }
    return null;
  }
  return out.length >= 2 ? out : null;
}

/** If every cell of a row is exactly one media node, return them in order. */
function galleryMedia(cells: Cell[]): Media[] | null {
  const out: Media[] = [];
  for (const c of cells) {
    const m = pureCellMedia(c);
    if (!m) return null;
    out.push(m);
  }
  return out.length >= 2 ? out : null;
}

/** Return a copy of the tree with every node matching `isMapMount` replaced by a
 * `widget:map` node. Pure — does not mutate the input. Top-down: a matched
 * container is replaced whole, so its children are never visited. */
function rewriteMapMounts(node: Node, isMapMount: (n: Node) => boolean): Node {
  if (isMapMount(node)) return { kind: "widget", widget: { type: "map" } };
  switch (node.kind) {
    case "row":
      return {
        kind: "row",
        cells: node.cells.map((c) => ({
          token: c.token,
          node: rewriteMapMounts(c.node, isMapMount),
        })),
        // Preserve the row's own markers when rebuilding: dropping the slider
        // would silently demote a Carousel to Grid, and dropping the style would
        // lose a card background — for every band whenever a map config exists.
        ...(node.slider ? { slider: node.slider } : {}),
        ...(node.style ? { style: node.style } : {}),
      };
    case "stack":
      return {
        kind: "stack",
        children: node.children.map((n) => rewriteMapMounts(n, isMapMount)),
        ...(node.style ? { style: node.style } : {}),
      };
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
    case "raw":
      return node;
  }
}

/** The single significant child of a container (ignoring empty raw), or the node
 * itself. Used to detect a band whose dominant content is one widget. */
function soleSignificant(node: Node): Node {
  let kids: Node[];
  switch (node.kind) {
    case "row":
      kids = node.cells.map((c) => c.node);
      break;
    case "stack":
      kids = node.children;
      break;
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
    case "raw":
      kids = [node];
      break;
  }
  const significant = kids.filter((n) => !isEmptyRaw(n));
  return significant.length === 1 && significant[0] ? significant[0] : node;
}

/** Classify one band into a SliceSpec. Conservative: only unambiguous shapes
 * become pattern slices; everything else is a render-faithful Grid fallback. */
export function classifyBand(band: Band, opts: ClassifyOptions = {}): SliceSpec {
  // Widget rewrite runs FIRST, so the pattern branches and the Grid fallback
  // all see `widget` nodes in place of injected mounts.
  const root = opts.isMapMount ? rewriteMapMounts(band.root, opts.isMapMount) : band.root;
  const widgets = collectWidgets(root);
  const media = collectMedia(root);
  const text = collectText(root);
  const rowNode = topRowNode(root);
  const row = rowNode ? rowNode.cells : null;
  // A raw node with real content is text we cannot account for — every
  // promotion must refuse to fire over it (only the Grid fallback keeps it).
  const hasSignificantRaw = collectRaws(root).some((n) => !isEmptyRaw(n));

  // Top-level widget promotion (before the structural patterns).
  const sole = soleSignificant(root);
  if (sole.kind === "widget" && sole.widget.type === "map") {
    return { slice: "LocationMap", ...base(band) };
  }
  if (
    media.length === 1 &&
    media[0]?.kind === "video" &&
    text.length === 0 &&
    widgets.length === 0 &&
    row === null &&
    !hasSignificantRaw
  ) {
    const v = media[0];
    return { slice: "VideoFeature", ...base(band), media: v };
  }

  const headings = text.filter((n) => n.kind === "heading");
  const subtitles = text.filter((n) => n.kind === "subtitle");
  const bodies = text.filter((n) => n.kind === "body");

  // Text-only bands (no media, no row, no widgets, no significant raw — any
  // co-located content must survive via the Grid fallback, not be swallowed).
  if (media.length === 0 && row === null && widgets.length === 0 && !hasSignificantRaw) {
    // TitleBand: exactly one heading + at most one subtitle, nothing else —
    // TitleBandSpec has nowhere to carry surplus text.
    if (headings.length === 1 && subtitles.length <= 1 && bodies.length === 0 && !band.background) {
      const first = headings[0];
      const sub = subtitles[0];
      return {
        slice: "TitleBand",
        ...base(band),
        heading: first ? nodeText(first) : "",
        ...(sub ? { subtitle: nodeText(sub) } : {}),
        ...textRoleMeta(first, sub),
      };
    }
    // RichText: body node(s) only — a subtitle would be dropped from the html.
    if (headings.length === 0 && subtitles.length === 0 && bodies.length > 0 && !band.background) {
      return {
        slice: "RichText",
        ...base(band),
        html: bodies.map((b) => (b.kind === "body" ? b.html : "")).join("\n"),
      };
    }
  }

  // Full-bleed hero: a background image with overlay text and no grid row. At
  // most one of each overlay text kind — HeroSpec keeps one heading/subtitle/
  // body, so surplus would be silently dropped.
  if (
    band.background &&
    headings.length === 1 &&
    subtitles.length <= 1 &&
    bodies.length <= 1 &&
    row === null &&
    media.length === 0 &&
    widgets.length === 0 &&
    !hasSignificantRaw
  ) {
    const h = headings[0];
    const sub = subtitles[0];
    const bod = bodies[0];
    return {
      slice: "Hero",
      ...base(band),
      ...(h ? { heading: nodeText(h) } : {}),
      ...(sub ? { subtitle: nodeText(sub) } : {}),
      ...(bod && bod.kind === "body" ? { body: bod.html } : {}),
      ...textRoleMeta(h, sub),
    };
  }

  // Carousel: a source slider row (.caslider) whose every cell is a media
  // slide, optionally captioned (stack[media, heading]). Anything richer
  // falls through to the faithful Grid fallback.
  if (rowNode?.slider) {
    const slides = carouselSlides(rowNode.cells);
    if (slides) {
      const spec: CarouselSpec = { slice: "Carousel", ...base(band), slides };
      if (rowNode.slider.columns !== undefined) spec.columns = rowNode.slider.columns;
      return spec;
    }
  }

  // Gallery: a row whose cells are all single media.
  if (row) {
    const gm = galleryMedia(row);
    if (gm) return { slice: "Gallery", ...base(band), media: gm };
  }

  // MediaFull: one media, no text, no top row, no widgets, no significant raw —
  // a row sibling, a co-located widget (e.g. a map mount), or raw prose would
  // be silently dropped, so those stay Grid.
  if (
    media.length === 1 &&
    text.length === 0 &&
    row === null &&
    widgets.length === 0 &&
    !hasSignificantRaw
  ) {
    const m = media[0];
    if (m) return { slice: "MediaFull", ...base(band), media: m };
  }

  // SplitFeature: exactly two cells, one pure media, one text-bearing.
  if (row && row.length === 2) {
    const [c0, c1] = row;
    if (c0 && c1) {
      const m0 = pureCellMedia(c0);
      const m1 = pureCellMedia(c1);
      const t0 = collectText(c0.node).length > 0;
      const t1 = collectText(c1.node).length > 0;
      if (m0 && !m1 && t1) {
        return {
          slice: "SplitFeature",
          ...base(band),
          media: m0,
          mediaSide: "left",
          ratio: cellRatio(c0),
          text: c1.node,
        };
      }
      if (m1 && !m0 && t0) {
        return {
          slice: "SplitFeature",
          ...base(band),
          media: m1,
          mediaSide: "right",
          ratio: cellRatio(c1),
          text: c0.node,
        };
      }
    }
  }

  return { slice: "Grid", ...base(band), root };
}

export function classifyBands(bands: Band[], opts: ClassifyOptions = {}): SliceSpec[] {
  return bands.map((b) => classifyBand(b, opts));
}
