import { HTMLElement } from "node-html-parser";

/** Map each <section> element to its document-order index. */
export function sectionIndexOf(root: HTMLElement): Map<HTMLElement, number> {
  const index = new Map<HTMLElement, number>();
  root.querySelectorAll("section").forEach((s, i) => index.set(s, i));
  return index;
}

/** Nearest-ancestor <section> key (`s{index}`), or `h` for chrome (nav/footer)
 *  that lives above/outside any <section>. */
export function sectionKeyOf(el: HTMLElement, sectionIndex: Map<HTMLElement, number>): string {
  let a: HTMLElement | null | undefined = el;
  while (a) {
    if (a.tagName === "SECTION" && sectionIndex.has(a)) {
      return `s${sectionIndex.get(a)}`;
    }
    a = a.parentNode as HTMLElement | null | undefined;
  }
  return "h";
}
