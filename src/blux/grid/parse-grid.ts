import { parse } from "node-html-parser";
import type { HTMLElement, Node as HTMLNode } from "node-html-parser";
import type { Band, Cell, GridToken, Media, Node } from "./types.js";
import { parseGridToken } from "./token.js";
import {
  textRoleFromClass,
  headingLevel,
  mediaFromElement,
  stripAssetExt,
  blockPlainText,
  readBgSizing,
  textLeafStyle,
  cssProp,
} from "./leaf.js";

const DEFAULT_TOKEN: GridToken = { cols: 1, raw: "grid-1" };

const isElement = (n: HTMLNode): n is HTMLElement =>
  (n as HTMLElement).tagName !== undefined && (n as HTMLElement).tagName !== null;

const hasClass = (el: HTMLElement, c: string) => el.classNames.split(/\s+/).includes(c);

/** A foreground media holder: a `block-media-holder`, a bare
 * `camediaload[data-media]`, or a `<video>`. */
const isMediaHolder = (el: HTMLElement): boolean =>
  hasClass(el, "block-media-holder") ||
  (hasClass(el, "camediaload") && !!el.getAttribute("data-media")) ||
  el.tagName === "VIDEO";

const isLeafElement = (el: HTMLElement): boolean =>
  hasClass(el, "block-title") ||
  hasClass(el, "block-body") ||
  hasClass(el, "block-subtitle") ||
  isMediaHolder(el);

/** A leaf `<a>`: a CTA button / text link with no structural descendants. Such
 * an anchor is not a wrapper — peeling through it (its inner text/spans are not
 * structural) would drop the link entirely — so it is treated as a structural
 * leaf. A linked media/grid wrapper (`<a>` containing a camediaload/grid) is NOT
 * a leaf anchor: it keeps peeling so the inner media parses normally. */
const isLeafAnchor = (el: HTMLElement): boolean =>
  el.tagName === "A" && collectStructuralChildren(el).length === 0;

/** Is this element a structural boundary (a leaf, a grid row, or a token-bearing
 * cell/holder), as opposed to a pure wrapper div we should peel through? */
const isStructural = (el: HTMLElement): boolean =>
  isLeafElement(el) ||
  el.hasAttribute("data-exec") || // Blux custom-code embed (e.g. map mount)
  hasClass(el, "cagrid") ||
  isLeafAnchor(el) ||
  parseGridToken(el.classNames) !== null;

/** The "card" styling inherited from the wrapper div(s) peeled to reach a
 * structural child — a Blux card's inline `background-color` (on the `.blocksN`
 * fill) and the `padding` its `.blocksNcontainer` insets the content by, both of
 * which the plain peel drops. The nearest wrapper wins for each. `nested` marks
 * that the walk has passed a grid-cell boundary (block-grid-container /
 * block-subcontent): only cell-level container padding is captured — the
 * BAND-level container's padding is the band's own content padding, already
 * handled via the band style/blockClass defaults, and capturing it here would
 * inset the content twice. */
type CardStyle = { background?: string; padding?: string; nested?: boolean };
/** A structural child plus any card styling peeled off its wrapper(s). */
type StructuralChild = { el: HTMLElement; card?: CardStyle };

/** A grid-cell boundary: once the peel passes one of these, wrappers below are
 * cell-level (their padding is real content inset, not band chrome). */
const isCellBoundary = (el: HTMLElement): boolean =>
  hasClass(el, "block-grid-container") || hasClass(el, "block-subcontent");

/** Inline `background-color` off an element's style attribute, ignoring the
 * transparent default (which is not a deviation worth carrying). */
function inlineBg(el: HTMLElement): string | undefined {
  const c = cssProp(el.getAttribute("style") ?? "", "background-color")?.trim();
  if (!c) return undefined;
  const low = c.toLowerCase().replace(/\s+/g, "");
  if (low === "transparent" || low === "rgba(0,0,0,0)") return undefined;
  return c;
}

/** Inline `padding` shorthand off an element's style attribute, ignoring an
 * all-zero value (no inset worth carrying). */
function inlinePadding(el: HTMLElement): string | undefined {
  const c = cssProp(el.getAttribute("style") ?? "", "padding")?.trim();
  if (!c) return undefined;
  if (/^(0(px|%|em|rem)?\s*)+$/i.test(c)) return undefined;
  return c;
}

/** The child elements that carry structure, peeling pure wrapper divs. A peeled
 * card wrapper's inline background-color and (cell-level) content padding ride
 * along to the structural node it wraps (the nearest wrapper wins for each) so
 * a card's fill and inset survive the peel.
 *
 * Two wrapper shapes are PROMOTED to structural instead of peeled, so they
 * parse to their own stack and the styling/containment attaches exactly once:
 * - a multi-child `block-subcontent`: a Blux grid CELL groups its blocks —
 *   the original contains their margins per cell (a block-content clearfix
 *   blocks the collapse), so flattening the boundary away merges rhythm that
 *   the original keeps separate;
 * - a padded wrapper around ≥2 structural children: threading the padding
 *   onto each child would inset every one of them (duplication) — the group
 *   is the thing that's padded. */
export function collectStructuralChildren(
  el: HTMLElement,
  inherited: CardStyle = {},
): StructuralChild[] {
  const out: StructuralChild[] = [];
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    const nested = inherited.nested === true || isCellBoundary(child);
    const background = inlineBg(child) ?? inherited.background;
    // Cell-level wrappers only — a band-level container's padding is the
    // band's own content padding (see CardStyle.nested).
    const padding = (nested ? inlinePadding(child) : undefined) ?? inherited.padding;
    const card: CardStyle = {
      ...(background !== undefined ? { background } : {}),
      ...(padding !== undefined ? { padding } : {}),
      ...(nested ? { nested } : {}),
    };
    const group =
      !isStructural(child) &&
      ((hasClass(child, "block-subcontent") && parseGridToken(child.classNames) === null) ||
        (nested && inlinePadding(child) !== undefined)) &&
      collectStructuralChildren(child).length >= 2;
    if (isStructural(child) || group) {
      out.push({
        el: child,
        ...(background !== undefined || padding !== undefined || nested ? { card } : {}),
      });
    } else {
      out.push(...collectStructuralChildren(child, card));
    }
  }
  return out;
}

/** Does a parsed leaf node carry real text (not just empty markup)? Gates caption
 * capture so an empty `.block-*` inside a media holder adds nothing. Routes
 * heading/body through `blockPlainText` (same as the subtitle path) so an
 * entity- or `&nbsp;`-only block reads as empty, not as text. */
function nodeHasText(n: Node): boolean {
  if (n.kind === "heading" || n.kind === "body") return blockPlainText(n.html) !== "";
  if (n.kind === "subtitle") return n.text.trim() !== "";
  return false;
}

/** Is a caption element (or an ancestor up to and including the media holder)
 * marked `class:"disable"`? Blux omits disabled blocks from the rendered HTML,
 * but guard anyway so hidden copy is never leaked into a caption. */
function isDisabledWithin(caption: HTMLElement, holder: HTMLElement): boolean {
  let a: HTMLElement | null | undefined = caption;
  while (a) {
    if (hasClass(a, "disable")) return true;
    if (a === holder) return false;
    a = a.parentNode as HTMLElement | null | undefined;
  }
  return false;
}

/** Parse one element into a grid Node. Leaves dispatch by role; everything else
 * becomes a row / stack / single / raw via parseContainer. */
export function parseNode(el: HTMLElement): Node {
  if (hasClass(el, "block-title") && /^H[1-6]$/.test(el.tagName ?? "")) {
    const role = textRoleFromClass(el.classNames);
    const style = textLeafStyle(el);
    return {
      kind: "heading",
      ...(role ? { role } : {}),
      ...(style ? { style } : {}),
      level: headingLevel(el),
      html: el.innerHTML,
    };
  }
  if (hasClass(el, "block-body")) {
    const role = textRoleFromClass(el.classNames);
    const style = textLeafStyle(el);
    return {
      kind: "body",
      ...(role ? { role } : {}),
      ...(style ? { style } : {}),
      html: el.innerHTML,
    };
  }
  if (hasClass(el, "block-subtitle")) {
    const role = textRoleFromClass(el.classNames);
    const style = textLeafStyle(el);
    // Route through blockPlainText (not raw `.text`): a `<br>` in a display
    // subtitle survives as a newline while insignificant source whitespace
    // collapses — `.text` alone can't tell a hard break from source formatting.
    return {
      kind: "subtitle",
      ...(role ? { role } : {}),
      ...(style ? { style } : {}),
      text: blockPlainText(el.innerHTML),
    };
  }
  if (isMediaHolder(el)) {
    const media = mediaFromElement(el);
    if (media) {
      // Blux slider tiles nest the slide's CAPTION inside the media holder (the
      // holder is `data-bgmedia` and the copy overlays it). The holder is an
      // opaque media leaf, so those captions would be dropped. When one carries
      // block-title/body/subtitle text, emit the media PLUS the caption(s) as a
      // stack so the copy survives. Pure-media holders — the vast majority —
      // stay a bare media node, byte-identical (no `.block-*` descendant → no
      // extra work). This does NOT change the peel boundary: the holder is still
      // a structural leaf; only its own internal text is recovered here.
      const captions = el
        .querySelectorAll(".block-title, .block-body, .block-subtitle")
        .filter((c) => !isDisabledWithin(c, el))
        .map((c) => parseNode(c))
        .filter(nodeHasText);
      if (captions.length) {
        return { kind: "stack", children: [{ kind: "media", media }, ...captions] };
      }
      return { kind: "media", media };
    }
  }
  if (el.hasAttribute("data-exec")) {
    // Custom-code embed (map, third-party widget). Keep the whole subtree —
    // including id="burbank_map" and any inline initMap/KmlLayer scripts — so
    // extract-map can read it and Grid.svelte can render it verbatim.
    return { kind: "raw", html: el.outerHTML };
  }
  if (el.tagName === "A") {
    // A leaf CTA button / text link (isLeafAnchor). Preserve the whole anchor —
    // href + label — verbatim so the render layer keeps the clickable link.
    return { kind: "raw", html: el.outerHTML };
  }
  return parseContainer(el);
}

/** Attach a peeled card wrapper's styling to a container node's `style`
 * (row/stack only — a Blux card wraps a grid or a stack of blocks, never a bare
 * leaf). The background is the card's fill; the padding is the content inset its
 * `.blocksNcontainer` applies. Padding rides only when a background marks this a
 * real card, so a plain band container's padding (already handled via the band's
 * blockClass defaults) is not double-captured onto a nested node. */
function withCardStyle(node: Node, card?: CardStyle): Node {
  if (!card || (card.background === undefined && card.padding === undefined)) return node;
  if (node.kind === "row" || node.kind === "stack") {
    const style: Record<string, string> = { ...(node.style ?? {}) };
    if (card.background !== undefined) style["background-color"] = card.background;
    if (card.padding !== undefined) style.padding = card.padding;
    return { ...node, style };
  }
  // A PADDED wrapper around a bare leaf (e.g. band 11's `20px 0 30px` cell
  // container wrapping a single heading): the leaf has no container-style slot,
  // so a synthetic one-child stack carries the box. A background-ONLY card
  // around a leaf still drops, as before — those (the carousel captions) are
  // handled by their own render path, and the Grid tree must not invent one.
  if (card.padding === undefined) return node;
  const style: Record<string, string> = { padding: card.padding };
  if (card.background !== undefined) style["background-color"] = card.background;
  return { kind: "stack", children: [node], style };
}

/** Parse a wrapper/cell/band-body element: a row when it is a grid or holds
 * ≥2 token-bearing children, else a stack / single / raw. */
export function parseContainer(el: HTMLElement): Node {
  // A container that IS a cell/grid element starts its walk inside the cell
  // context, so its own inner wrappers' padding is captured (CardStyle.nested).
  const kids = collectStructuralChildren(
    el,
    isCellBoundary(el) || hasClass(el, "cagrid") ? { nested: true } : {},
  );
  // Parse each structural child up front, then drop any that collapse to an
  // EMPTY raw — an empty `.caslider`/wrapper (no static slides, JS-hydrated)
  // yields `raw:""`, which would otherwise survive as a phantom sibling (e.g.
  // turning a lone poster image into `[media, empty-block]`). A non-empty raw
  // (a `[data-exec]` embed, a leaf `<a>`) always has real html, so it is kept.
  // A structural child may carry `card` styling (background + padding) peeled off
  // a card wrapper — it rides onto that child's container node via withCardStyle.
  const parsed = kids
    .map((k) => ({
      token: parseGridToken(k.el.classNames),
      node: withCardStyle(parseNode(k.el), k.card),
    }))
    .filter((p) => !(p.node.kind === "raw" && p.node.html.trim() === ""));
  const isGrid = hasClass(el, "cagrid");
  const tokenCount = parsed.filter((p) => p.token).length;

  if ((isGrid || tokenCount >= 2) && parsed.length > 0) {
    const cells: Cell[] = parsed.map((p) => ({ token: p.token ?? DEFAULT_TOKEN, node: p.node }));
    if (hasClass(el, "caslider")) {
      // A source slider row. `data-columns` = slides visible at a time; only a
      // positive integer is meaningful (conditional build keeps `columns`
      // absent, not undefined, under exactOptionalPropertyTypes).
      const cols = Number(el.getAttribute("data-columns"));
      const slider = Number.isInteger(cols) && cols > 0 ? { columns: cols } : {};
      return { kind: "row", cells, slider };
    }
    return { kind: "row", cells };
  }
  const [only] = parsed;
  if (parsed.length === 1 && only) return only.node;
  if (parsed.length === 0) return { kind: "raw", html: el.innerHTML };
  return { kind: "stack", children: parsed.map((p) => p.node) };
}

const BAND_ID_RE = /^page-block-(\d+)$/;
// The band wrapper's blocksN class — kept off the HTML because site.json
// items[].class is unreliable (null for 7/16 the-pointe blocks).
const BLOCK_CLASS_RE = /\bblocks\d+\b/;

/** Read the band-level background media off a `camediaload` band wrapper. */
function bandBackground(el: HTMLElement): Media | undefined {
  if (!hasClass(el, "camediaload")) return undefined;
  const rawId = el.getAttribute("data-media");
  if (!rawId) return undefined;
  const ext = el.getAttribute("data-ext") ?? undefined;
  const base = el.getAttribute("data-base") ?? undefined;
  return {
    kind: "image",
    assetId: stripAssetExt(rawId, ext),
    ...(ext ? { ext } : {}),
    ...(base ? { base } : {}),
    // A band background carries its own render sizing (background-size/position);
    // a corner-anchored `auto` accent must not be centered + full-bleed.
    ...readBgSizing(el),
  };
}

/** Parse the rendered Blux index.html into the page's top-level band tree. */
export function parseGridBands(html: string): Band[] {
  const root = parse(html);
  const content = root.querySelector("#page-content");
  if (!content) return [];
  const bands: Band[] = [];
  for (const child of content.childNodes) {
    if (!isElement(child)) continue;
    const m = BAND_ID_RE.exec(child.getAttribute("id") ?? "");
    if (!m) continue;
    const idStr = m[1];
    if (idStr === undefined) continue;
    const background = bandBackground(child);
    const blockClass = BLOCK_CLASS_RE.exec(child.classNames)?.[0];
    bands.push({
      index: Number(idStr),
      ...(blockClass ? { blockClass } : {}),
      ...(background ? { background } : {}),
      root: parseContainer(child),
    });
  }
  return bands;
}
