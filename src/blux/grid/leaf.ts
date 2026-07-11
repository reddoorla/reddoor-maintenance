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

/** Resolve the media an element carries: a `.camediaload` descendant (image, via
 * `data-media`) or a `<video>` (via its src uuid). Returns null when there is none. */
export function mediaFromElement(el: HTMLElement): Media | null {
  if (el.tagName === "VIDEO") {
    const src = el.getAttribute("src") ?? "";
    const { id, ext } = uuidFromUrl(src);
    return id ? { kind: "video", assetId: id, ...(ext ? { ext } : {}) } : null;
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
      };
    }
  }
  const video = el.querySelector("video");
  if (video) return mediaFromElement(video);
  return null;
}
