import { parse } from "node-html-parser";
import type { HTMLElement, Node as HTMLNode } from "node-html-parser";
import type { Band, Cell, GridToken, Media, Node } from "./types.js";
import { parseGridToken } from "./token.js";
import { textRoleFromClass, headingLevel, mediaFromElement, stripAssetExt } from "./leaf.js";

const DEFAULT_TOKEN: GridToken = { cols: 1, raw: "grid-1" };

const isElement = (n: HTMLNode): n is HTMLElement =>
  (n as HTMLElement).tagName !== undefined && (n as HTMLElement).tagName !== null;

const hasClass = (el: HTMLElement, c: string) => el.classNames.split(/\s+/).includes(c);

const isLeafElement = (el: HTMLElement): boolean =>
  hasClass(el, "block-title") ||
  hasClass(el, "block-body") ||
  hasClass(el, "block-subtitle") ||
  hasClass(el, "block-media-holder") ||
  (hasClass(el, "camediaload") && !!el.getAttribute("data-media")) ||
  el.tagName === "VIDEO";

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
    return { kind: "subtitle", ...(role ? { role } : {}), text: el.text.trim() };
  }
  if (
    hasClass(el, "block-media-holder") ||
    (hasClass(el, "camediaload") && !!el.getAttribute("data-media")) ||
    el.tagName === "VIDEO"
  ) {
    const media = mediaFromElement(el);
    if (media) return { kind: "media", media };
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
  const tokens = kids.map((k) => parseGridToken(k.classNames));
  const isGrid = hasClass(el, "cagrid");
  const tokenCount = tokens.filter(Boolean).length;

  if ((isGrid || tokenCount >= 2) && kids.length > 0) {
    const cells: Cell[] = kids.map((k, i) => ({
      token: tokens[i] ?? DEFAULT_TOKEN,
      node: parseNode(k),
    }));
    return { kind: "row", cells };
  }
  const [only] = kids;
  if (kids.length === 1 && only) return parseNode(only);
  if (kids.length === 0) return { kind: "raw", html: el.innerHTML };
  return { kind: "stack", children: kids.map((k) => parseNode(k)) };
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
