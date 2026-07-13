import type { HTMLElement } from "node-html-parser";
import type { Media } from "./types.js";

const ROLE_RE = /\btext\d+\b/;

/** The Blux text role (`text5`, `text11`, …) carried on a block-title/body/subtitle
 * element's class in the rendered HTML, or undefined when none is present. */
export function textRoleFromClass(className: string): string | undefined {
  return ROLE_RE.exec(className)?.[0];
}

/** The heading level (1..6) for an h1..h6 element. */
export function headingLevel(el: HTMLElement): number {
  const m = /^H([1-6])$/.exec(el.tagName ?? "");
  return m ? Number(m[1]) : 2;
}

/** Plain text of a block's inner HTML for a title field: a hard line break
 * (`<br>`, with or without attributes/self-close) becomes a newline; every other
 * tag and all source-formatting whitespace collapse to single spaces. Robust to
 * pretty-printed exports — insignificant newlines in the markup are NOT mistaken
 * for hard breaks — by routing `<br>` through a sentinel that survives the
 * whitespace collapse. */
export function blockPlainText(html: string): string {
  const BR = "\uE000";
  return html
    .replace(/<br\b[^>]*>/gi, BR)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ *\uE000 */g, "\n")
    .trim();
}

/** The last path segment of a CDN url, sans extension (the Blux asset uuid). */
function uuidFromUrl(url: string): { id: string; ext?: string } {
  const base = url.split(/[?#]/)[0] ?? "";
  const file = base.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? { id: file.slice(0, dot), ext: file.slice(dot + 1) } : { id: file };
}

/** Blux `data-media` is sometimes `uuid.ext` and sometimes a bare `uuid`; the
 * existing asset pipeline keys on the bare uuid (extension stripped), matching the
 * video path. Strip a trailing `.<ext>` when `data-ext` names it. */
export function stripAssetExt(rawId: string, ext?: string): string {
  return ext && rawId.endsWith(`.${ext}`) ? rawId.slice(0, -(ext.length + 1)) : rawId;
}

/** Read a single CSS declaration's value out of an inline `style` string. */
function cssProp(style: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m?.[1]?.trim();
}

/** Intrinsic render sizing off a foreground image holder: the inline pixel
 * `width`, the `.mediaRatio` `data-og-ratio` (→ `aspect`), and the
 * `background-size` (→ `fit`, only when contain/cover — a background's `auto`
 * is not foreground sizing). Each field is present only when the source has it,
 * so a plain holder still yields a bare `Media`. */
function readImgSizing(holder: HTMLElement): Pick<Media, "width" | "aspect" | "fit"> {
  const style = holder.getAttribute("style") ?? "";
  const out: Pick<Media, "width" | "aspect" | "fit"> = {};
  // Only a pixel width is a faithful intrinsic size. A `%`/`vw`/`em`/`calc()`
  // width is relative to context and must NOT be mistaken for px (which the
  // render layer would then apply literally) — skip it, leaving `width` absent.
  const w = cssProp(style, "width");
  const wpx = w ? /^(\d+(?:\.\d+)?)px$/.exec(w) : null;
  if (wpx?.[1]) out.width = Math.round(parseFloat(wpx[1]));
  const ogr = holder.querySelector(".mediaRatio")?.getAttribute("data-og-ratio");
  if (ogr) {
    const n = Number(ogr);
    if (Number.isFinite(n)) out.aspect = Math.round(n * 1000) / 1000;
  }
  const fit = cssProp(style, "background-size");
  if (fit === "contain" || fit === "cover") out.fit = fit;
  return out;
}

/** Resolve the media an element carries: a `.camediaload` descendant (image, via
 * `data-media`) or a `<video>` (via its src uuid). Returns null when there is none. */
export function mediaFromElement(el: HTMLElement): Media | null {
  if (el.tagName === "VIDEO") {
    const src = el.getAttribute("src") ?? "";
    const { id, ext } = uuidFromUrl(src);
    if (!id) return null;
    // The full CDN url sits on `<video src>`; capture its prefix as `base` (the
    // same field an image carries from `data-base`) so `mediaCdnUrl` rebuilds it
    // OFFLINE. Without this a video resolves only via the IR sourceUrl, i.e. it
    // depends on site.json listing the asset — breaking convert's offline
    // invariant even though the url is right here in the markup.
    const clean = src.split(/[?#]/)[0] ?? "";
    const slash = clean.lastIndexOf("/");
    const base = slash >= 0 ? clean.slice(0, slash + 1) : undefined;
    return { kind: "video", assetId: id, ...(ext ? { ext } : {}), ...(base ? { base } : {}) };
  }
  const img =
    el.classList.contains("camediaload") && el.getAttribute("data-media")
      ? el
      : el.querySelector(".camediaload[data-media]");
  if (img) {
    const rawId = img.getAttribute("data-media");
    if (rawId) {
      const ext = img.getAttribute("data-ext") ?? undefined;
      const base = img.getAttribute("data-base") ?? undefined;
      return {
        kind: "image",
        assetId: stripAssetExt(rawId, ext),
        ...(ext ? { ext } : {}),
        ...(base ? { base } : {}),
        ...readImgSizing(img),
      };
    }
  }
  const video = el.querySelector("video");
  if (video) return mediaFromElement(video);
  return null;
}
