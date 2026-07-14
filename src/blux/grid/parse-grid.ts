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

/** The child elements that carry structure, peeling pure wrapper divs. */
export function collectStructuralChildren(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    if (isStructural(child)) out.push(child);
    else out.push(...collectStructuralChildren(child));
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
    return {
      kind: "heading",
      ...(role ? { role } : {}),
      level: headingLevel(el),
      html: el.innerHTML,
    };
  }
  if (hasClass(el, "block-body")) {
    const role = textRoleFromClass(el.classNames);
    return { kind: "body", ...(role ? { role } : {}), html: el.innerHTML };
  }
  if (hasClass(el, "block-subtitle")) {
    const role = textRoleFromClass(el.classNames);
    // Route through blockPlainText (not raw `.text`): a `<br>` in a display
    // subtitle survives as a newline while insignificant source whitespace
    // collapses — `.text` alone can't tell a hard break from source formatting.
    return { kind: "subtitle", ...(role ? { role } : {}), text: blockPlainText(el.innerHTML) };
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

/** Parse a wrapper/cell/band-body element: a row when it is a grid or holds
 * ≥2 token-bearing children, else a stack / single / raw. */
export function parseContainer(el: HTMLElement): Node {
  const kids = collectStructuralChildren(el);
  // Parse each structural child up front, then drop any that collapse to an
  // EMPTY raw — an empty `.caslider`/wrapper (no static slides, JS-hydrated)
  // yields `raw:""`, which would otherwise survive as a phantom sibling (e.g.
  // turning a lone poster image into `[media, empty-block]`). A non-empty raw
  // (a `[data-exec]` embed, a leaf `<a>`) always has real html, so it is kept.
  const parsed = kids
    .map((k) => ({ token: parseGridToken(k.classNames), node: parseNode(k) }))
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
    bands.push({
      index: Number(idStr),
      ...(background ? { background } : {}),
      root: parseContainer(child),
    });
  }
  return bands;
}
