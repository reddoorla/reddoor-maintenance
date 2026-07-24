import { parse } from "node-html-parser";
import { slotKey, tokenFor, type Slot } from "./types.js";
import { sectionIndexOf, sectionKeyOf } from "./section.js";

// Blux media elements carry the image as data-attributes, not a live src: the
// runtime reads `data-base` (CDN folder) + `data-size` (width) + `data-media`
// (filename) and sets a background-image on a lazy `.load-media-element` span
// (loading/unloading per viewport). We assemble the url deterministically
// instead — `{data-base}w:{data-size}/{data-media}` (verified 200) — and bake it
// as an inline background-image token so no runtime is needed. An element with
// `data-bgmedia` is a full-bleed layer; that filename wins over `data-media`.

/**
 * Assemble + inline every media element's background-image as a `⟦i:KEY⟧` token
 * and collect the originals as image slots (document order, keyed per section).
 */
export function bakeImages(html: string): { html: string; slots: Slot[] } {
  const root = parse(html);
  const sectionIndex = sectionIndexOf(root);
  const counters = new Map<string, number>();
  const slots: Slot[] = [];

  for (const el of root.querySelectorAll("[data-media],[data-bgmedia]")) {
    const base = el.getAttribute("data-base");
    if (!base) continue;
    const bg = el.getAttribute("data-bgmedia");
    const media = bg ?? el.getAttribute("data-media");
    if (!media) continue;
    const size = el.getAttribute("data-size");
    const sizeSeg = size ? `w:${size}/` : bg ? "w:1600/" : "";
    const url = `${base}${sizeSeg}${media}`;

    const section = sectionKeyOf(el, sectionIndex);
    const n = counters.get(section) ?? 0;
    counters.set(section, n + 1);
    const key = slotKey(section, "image", n);
    slots.push({ key, kind: "image", url, section });

    const decl = `background-image:url(${tokenFor("image", key)})`;
    const style = el.getAttribute("style");
    el.setAttribute("style", style ? `${style};${decl}` : decl);
  }

  return { html: root.toString(), slots };
}
