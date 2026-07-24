import { parse, HTMLElement, NodeType } from "node-html-parser";
import { slotKey, tokenFor, type Slot } from "./types.js";

// Elements whose text is not editable page copy.
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "TITLE", "SVG"]);

/** Nearest-ancestor <section> key (`s{index}`), or `h` for chrome (nav/footer)
 *  that lives above/outside any <section>. */
function sectionKeyOf(
  el: HTMLElement,
  sectionIndex: Map<HTMLElement, number>,
): string {
  let a: HTMLElement | null | undefined = el;
  while (a) {
    if (a.tagName === "SECTION" && sectionIndex.has(a)) {
      return `s${sectionIndex.get(a)}`;
    }
    a = a.parentNode as HTMLElement | null | undefined;
  }
  return "h";
}

/**
 * Replace every non-whitespace text node with a `⟦t:KEY⟧` token and collect the
 * originals as text slots. Keys are `s{section}.t{n}` in document order so the
 * template + manifest stay stable across re-freezes (golden canary). The raw
 * source text is preserved verbatim (entities and surrounding whitespace) so a
 * frozen render is byte-faithful before any Prismic edit.
 */
export function tokenizeText(html: string): { html: string; slots: Slot[] } {
  const root = parse(html);
  const sections = root.querySelectorAll("section");
  const sectionIndex = new Map<HTMLElement, number>();
  sections.forEach((s, i) => sectionIndex.set(s, i));

  const counters = new Map<string, number>();
  const slots: Slot[] = [];

  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        const raw = child.rawText;
        if (raw && raw.trim() !== "") {
          const section = sectionKeyOf(el, sectionIndex);
          const n = counters.get(section) ?? 0;
          counters.set(section, n + 1);
          const key = slotKey(section, "text", n);
          slots.push({ key, kind: "text", text: raw, section });
          child.rawText = tokenFor("text", key);
        }
      } else if (child.nodeType === NodeType.ELEMENT_NODE) {
        const elChild = child as HTMLElement;
        if (!SKIP.has(elChild.tagName)) walk(elChild);
      }
    }
  };
  walk(root);

  return { html: root.toString(), slots };
}
