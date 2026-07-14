import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import type { Media, VideoPlayback } from "./types.js";

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
 * tag drops and HTML entities decode (`Bar &amp; Grill` → `Bar & Grill`); all
 * source-formatting whitespace collapses to single spaces. Robust to
 * pretty-printed exports — insignificant newlines in the markup are NOT mistaken
 * for hard breaks — by routing `<br>` through a sentinel that survives the
 * whitespace collapse. */
export function blockPlainText(html: string): string {
  const BR = "\uE000";
  // node-html-parser `.text` strips tags AND decodes entities; the <br>→BR swap
  // runs first so hard breaks survive as the sentinel through the collapse below.
  const text = parse(html.replace(/<br\b[^>]*>/gi, BR)).text;
  return text
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
export function cssProp(style: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m?.[1]?.trim();
}

const MARGIN_UTIL_RE = /\bmargin-(\d+)(r|l|t|b)\b/g;
const MARGIN_SIDES = { r: "right", l: "left", t: "top", b: "bottom" } as const;

/** Decode Blux margin utility classes: `margin-20r` → `margin-right: 20%`.
 * Only `margin-N(r|l|t|b)` decodes — the `pd_*` padding utilities are always
 * duplicated inline in the export, so inline capture already covers them. */
export function utilityStylesFromClass(className: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of className.matchAll(MARGIN_UTIL_RE)) {
    const [, n, side] = m;
    if (n && side) out[`margin-${MARGIN_SIDES[side as keyof typeof MARGIN_SIDES]}`] = `${n}%`;
  }
  return out;
}

/** A text leaf's style deviations: the allowlisted inline declarations (`color`,
 * `padding`, `margin*` — everything else is theme noise) merged with the margin
 * utilities decoded off its class. An inline declaration wins over a class
 * utility on conflict. Null when the leaf carries neither, so callers can keep
 * the `style` key absent (exactOptionalPropertyTypes). */
export function textLeafStyle(el: HTMLElement): Record<string, string> | null {
  const out = utilityStylesFromClass(el.classNames ?? "");
  for (const decl of (el.getAttribute("style") ?? "").split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!value) continue;
    if (prop === "color" || prop === "padding" || prop.startsWith("margin")) out[prop] = value;
  }
  return Object.keys(out).length ? out : null;
}

const CENTERED = new Set(["center", "center center", "50% 50%", "50%"]);

/** Background sizing off a BAND-background wrapper's inline style: its
 * `background-size` → `fit` (a background's `auto`/`contain` is meaningful — a
 * native-size decorative accent, not a full-bleed `cover`) and its
 * `background-position` → `position` (e.g. "right bottom"). Unlike `readImgSizing`
 * (foreground), `auto` is kept; `cover` and a centered position are the render
 * defaults, so they are left absent to keep the manifest to deviations only. */
export function readBgSizing(el: HTMLElement): Pick<Media, "fit" | "position"> {
  const style = el.getAttribute("style") ?? "";
  const out: Pick<Media, "fit" | "position"> = {};
  const size = cssProp(style, "background-size")?.toLowerCase();
  if (size === "auto" || size === "contain") out.fit = size;
  const pos = cssProp(style, "background-position");
  if (pos && !CENTERED.has(pos.toLowerCase())) out.position = pos;
  return out;
}

/** Intrinsic render sizing off a foreground image holder: the inline pixel
 * `width`, the `.mediaRatio` `data-og-ratio` (→ `aspect`), and the
 * `background-size` (→ `fit`, only when contain/cover — a background's `auto`
 * is not foreground sizing). Each field is present only when the source has it,
 * so a plain holder still yields a bare `Media`. */
function readImgSizing(holder: HTMLElement): Pick<Media, "width" | "aspect" | "fit" | "minHeight"> {
  const style = holder.getAttribute("style") ?? "";
  const out: Pick<Media, "width" | "aspect" | "fit" | "minHeight"> = {};
  // Only a pixel width is a faithful intrinsic size. A `%`/`vw`/`em`/`calc()`
  // width is relative to context and must NOT be mistaken for px (which the
  // render layer would then apply literally) — skip it, leaving `width` absent.
  const w = cssProp(style, "width");
  const wpx = w ? /^(\d+(?:\.\d+)?)px$/i.exec(w) : null;
  if (wpx?.[1]) out.width = Math.round(parseFloat(wpx[1]));
  const ogr = holder.querySelector(".mediaRatio")?.getAttribute("data-og-ratio");
  if (ogr) {
    const n = Number(ogr);
    if (Number.isFinite(n)) out.aspect = Math.round(n * 1000) / 1000;
  }
  const fit = cssProp(style, "background-size")?.toLowerCase();
  if (fit === "contain" || fit === "cover") out.fit = fit;
  // The holder's inline min-height (e.g. "80vh" on a slider slide) is the
  // height the export reserves for a cover-rendered frame — keep it.
  const mh = cssProp(style, "min-height");
  if (mh) out.minHeight = mh;
  return out;
}

/** Playback semantics from a `<video>`'s boolean attributes — only those PRESENT
 * are set (an absent field = attribute absent). Undefined when none is present. */
function readVideoPlayback(video: HTMLElement): VideoPlayback | undefined {
  const flags = ["controls", "playsinline", "autoplay", "loop", "muted"] as const;
  const pb: VideoPlayback = {};
  for (const f of flags) if (video.hasAttribute(f)) pb[f] = true;
  return Object.keys(pb).length ? pb : undefined;
}

/** Intrinsic aspect for a foreground `<video>`, reserved on a nearby
 * `.ib[data-og-ratio]` holder OR a `.mediaRatio` (inline `padding-bottom:NN%`).
 * Values are percent-suffixed strings (e.g. "56.25%") — strip the `%` (raw
 * `Number()` NaNs), then reuse the `aspect` = height-%-of-width convention.
 * Fail-safe: no parseable ratio → undefined (video keeps its bare shape). */
function readVideoAspect(video: HTMLElement): number | undefined {
  let raw: string | undefined;
  let anc: HTMLElement | null | undefined = video.parentNode;
  for (let i = 0; i < 3 && anc && !raw; i++) {
    raw = anc.getAttribute?.("data-og-ratio") ?? undefined;
    if (!raw) {
      const mr = anc.querySelector?.(".mediaRatio");
      raw = mr ? cssProp(mr.getAttribute("style") ?? "", "padding-bottom") : undefined;
    }
    anc = anc.parentNode as HTMLElement | null | undefined;
  }
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/%\s*$/, ""));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : undefined;
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
    const aspect = readVideoAspect(el);
    const playback = readVideoPlayback(el);
    return {
      kind: "video",
      assetId: id,
      ...(ext ? { ext } : {}),
      ...(base ? { base } : {}),
      ...(aspect !== undefined ? { aspect } : {}),
      ...(playback ? { playback } : {}),
    };
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
