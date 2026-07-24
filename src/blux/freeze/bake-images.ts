import { parse, HTMLElement } from "node-html-parser";
import { slotKey, tokenFor, type Slot } from "./types.js";
import { sectionIndexOf, sectionKeyOf } from "./section.js";
import { CDN_HOSTS } from "../assets.js";

const isCdnUrl = (v: string): boolean => CDN_HOSTS.some((h) => v.includes(h));

// Blux media elements carry the image as data-attributes, not a live src: the
// runtime reads `data-base` (CDN folder) + `data-size` (width) + `data-media`
// (filename) and paints a background on a lazy `.load-media-element` span
// (loading/unloading per viewport). We assemble the url deterministically —
// `{data-base}w:{data-size}/{data-media}` (verified 200) — and bake it as an
// inline background-image token so no runtime is needed. `data-bgmedia` is a
// full-bleed layer whose filename wins over `data-media`. A second pass catches
// any other CDN url still living in src/href/poster (e.g. a <video>), so the
// frozen template leaks no CDN host at all.

// Runtime-only url hints the (removed) Blux JS used; not rendered — drop them so
// they don't leak a CDN host.
function stripUrlHintAttrs(root: HTMLElement): void {
  for (const el of root.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      if (name === "data-og-src" || name.startsWith("data-swaps")) {
        el.removeAttribute(name);
      }
    }
  }
}

/**
 * Tokenize every media url in the document as a `⟦i:KEY⟧` image slot. Pass 1:
 * data-attribute backgrounds → inline `background-image:url(token)`. Pass 2: any
 * remaining CDN url in `src`/`href`/`poster` → bare `token`. Keys are
 * `s{section}.i{n}` in document order.
 */
export function bakeImages(html: string): { html: string; slots: Slot[] } {
  const root = parse(html);
  const sectionIndex = sectionIndexOf(root);
  const counters = new Map<string, number>();
  const slots: Slot[] = [];

  const nextKey = (el: HTMLElement): string => {
    const section = sectionKeyOf(el, sectionIndex);
    const n = counters.get(section) ?? 0;
    counters.set(section, n + 1);
    return slotKey(section, "image", n);
  };

  // Pass 1: data-* backgrounds. The filename is ALWAYS `data-media`;
  // `data-bgmedia` is a boolean flag ("1") marking a full-bleed layer — it is
  // NOT a filename. When an element is unsized we default full-bleed layers to a
  // wide variant and inline images to the raw file.
  for (const el of root.querySelectorAll("[data-media]")) {
    const base = el.getAttribute("data-base");
    if (!base) continue;
    const media = el.getAttribute("data-media");
    if (!media) continue;
    const isBg = el.getAttribute("data-bgmedia") != null;
    const size = el.getAttribute("data-size");
    const sizeSeg = size ? `w:${size}/` : isBg ? "w:1600/" : "";
    const url = `${base}${sizeSeg}${media}`;

    const key = nextKey(el);
    slots.push({ key, kind: "image", url, section: sectionKeyOf(el, sectionIndex) });
    const decl = `background-image:url(${tokenFor("image", key)})`;
    const style = el.getAttribute("style");
    el.setAttribute("style", style ? `${style};${decl}` : decl);
    el.removeAttribute("data-base");
  }

  // Pass 2: any remaining CDN url in src/href/poster (video, source, links…).
  for (const el of root.querySelectorAll("[src],[href],[poster]")) {
    for (const attr of ["src", "href", "poster"] as const) {
      const v = el.getAttribute(attr);
      if (!v || !isCdnUrl(v)) continue;
      const key = nextKey(el);
      slots.push({ key, kind: "image", url: v, section: sectionKeyOf(el, sectionIndex) });
      el.setAttribute(attr, tokenFor("image", key));
    }
  }

  stripUrlHintAttrs(root);
  return { html: root.toString(), slots };
}
