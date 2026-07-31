import { parse, HTMLElement, NodeType } from "node-html-parser";
import { slotKey, tokenFor, type Slot } from "./types.js";
import { sectionIndexOf, sectionKeyOf } from "./section.js";

// Elements whose text is not editable page copy.
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "TITLE", "SVG"]);

/**
 * Replace every text node that carries CONTENT with a `⟦t:KEY⟧` token and
 * collect the originals as text slots. Keys are `s{section}.t{n}` in document
 * order so the template + manifest stay stable across re-freezes (golden
 * canary). The raw source text is preserved verbatim (entities and surrounding
 * whitespace) so a frozen render is byte-faithful before any Prismic edit.
 *
 * "Carries content" is decided on the DECODED text, not the raw source. Page
 * builders emit whitespace-only leaves as layout — a list item or table cell
 * holding `&nbsp;` purely to occupy a line — and those must stay literal in the
 * template rather than becoming CMS fields, for two reasons:
 *
 * 1. They are not editable copy. Nobody wants a Prismic field whose only
 *    correct value is "one blank line".
 * 2. Prismic Rich Text CANNOT store a whitespace-only value. It round-trips to
 *    "", the row collapses to its padding, and the page silently loses a line
 *    of vertical rhythm — a defect that only shows up after the migration, on
 *    the live site, in a place nobody thought to re-measure.
 *
 * `rawText.trim()` cannot see this: for a `&nbsp;` leaf it trims to the literal
 * string "&nbsp;", which is not empty, so the leaf looked like content. Testing
 * the decoded `.text` catches every spelling — `&nbsp;`, `&#160;`, `&#xa0;`,
 * `&emsp;`, `&thinsp;` — because JS `String.trim()` strips the whole Unicode
 * whitespace class. A real character such as `&amp;` still decodes to content
 * and is tokenized as before.
 */
export function tokenizeText(html: string): { html: string; slots: Slot[] } {
  const root = parse(html);
  const sectionIndex = sectionIndexOf(root);

  const counters = new Map<string, number>();
  const slots: Slot[] = [];

  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        const raw = child.rawText;
        // Decoded, so entity-encoded whitespace is treated as the whitespace it
        // is. A skipped leaf does not advance the section counter — same as a
        // plain-whitespace leaf, which this check has always skipped.
        if (raw && child.text.trim() !== "") {
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
