import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { PageExtract } from "./types.js";

/** Subtrees a browser never renders. Skipped WHOLE — including their headings,
 *  images and schema blocks, which a <template> stamp would otherwise donate to
 *  the page's real counts. */
export const UNRENDERED_TAGS = new Set(["STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);

/** Elements that force a break in rendered text. Inline elements deliberately do
 *  NOT: `<b>Acme</b>Corp` is one word on screen and must stay one word here,
 *  because the raw-vs-rendered word diff is what the audit's headline number is
 *  made of, and an invented word break biases it in only one direction. */
const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Word/Google-Docs paste soup and broken page-builder plugins nest ordinary
 *  formatting spans far past anything hand-written markup would reach — a
 *  plain recursive walk throws `RangeError: Maximum call stack size exceeded`
 *  around 5,000 levels, which would take the whole audit down with it.
 *  Mirrors checks.ts's `MAX_SCHEMA_DEPTH` precedent: generous enough that no
 *  real page is anywhere near it, so only pathological nesting is affected —
 *  the branch simply stops descending and the extract is honestly partial. */
const MAX_WALK_DEPTH = 100;

/** Rendered text of one element: text nodes concatenated with NO inserted
 *  separator, a newline at each block boundary, whitespace collapsed last —
 *  which is what a browser shows. TITLE and SCRIPT are dropped wherever they
 *  appear, since a <title> misplaced in <body> is still invisible. */
function textOf(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: HTMLElement, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    for (const child of node.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        parts.push(child.text);
        continue;
      }
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      const tag = e.tagName;
      if (UNRENDERED_TAGS.has(tag) || tag === "SCRIPT" || tag === "TITLE") continue;
      const block = BLOCK.has(tag);
      if (block) parts.push("\n");
      walk(e, depth + 1);
      if (block) parts.push("\n");
    }
  };
  walk(el, 0);
  return collapse(parts.join(""));
}

type Collected = {
  metas: HTMLElement[];
  links: HTMLElement[];
  jsonLd: string[];
  images: HTMLElement[];
  headings: { level: number; text: string }[];
  title: string | null;
};

/** One ordered pass for the element-level signals. Document order matters: the
 *  heading sequence drives a later level-skip check. Depth-limited for the
 *  same reason as `textOf`'s walk — see `MAX_WALK_DEPTH`. */
function collect(el: HTMLElement, out: Collected, depth = 0): void {
  if (depth > MAX_WALK_DEPTH) return;
  for (const child of el.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    const tag = e.tagName;
    if (UNRENDERED_TAGS.has(tag)) continue;
    switch (tag) {
      case "META":
        out.metas.push(e);
        break;
      case "LINK":
        out.links.push(e);
        break;
      case "IMG":
        out.images.push(e);
        break;
      case "TITLE":
        if (out.title === null) out.title = collapse(e.text) || null;
        break;
      case "SCRIPT":
        if ((e.getAttribute("type") ?? "").toLowerCase().trim() === "application/ld+json") {
          out.jsonLd.push(e.text);
        }
        // Raw-text element — nothing inside to walk.
        continue;
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = textOf(e);
        if (text) out.headings.push({ level: Number(tag.slice(1)), text });
        break;
      }
    }
    collect(e, out, depth + 1);
  }
}

/** Parse one HTML document into the signals every downstream check reads.
 *  Pure — the same input always yields the same extract. */
export function extractPage(html: string): PageExtract {
  const root = parse(html);
  // node-html-parser surfaces `<!doctype html>` as a TEXT node that is a SIBLING
  // of <html>, not a doctype node, so the walk starts at <html> when there is one.
  const documentEl = root.querySelector("html") ?? root;
  const out: Collected = {
    metas: [],
    links: [],
    jsonLd: [],
    images: [],
    headings: [],
    title: null,
  };
  collect(documentEl, out);

  const social: Record<string, string> = {};
  let metaDescription: string | null = null;
  let hasViewportMeta = false;
  for (const m of out.metas) {
    const key = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase().trim();
    if (!key) continue;
    const content = (m.getAttribute("content") ?? "").trim();
    if (key === "description") metaDescription = content || null;
    else if (key === "viewport") hasViewportMeta = content.length > 0;
    else if (key.startsWith("og:") || key.startsWith("twitter:")) social[key] = content;
  }

  const canonicalEl = out.links.find(
    (l) => (l.getAttribute("rel") ?? "").toLowerCase().trim() === "canonical",
  );

  return {
    title: out.title,
    metaDescription,
    canonical: canonicalEl?.getAttribute("href")?.trim() || null,
    social,
    headings: out.headings,
    jsonLd: out.jsonLd,
    images: {
      total: out.images.length,
      withAlt: out.images.filter((i) => (i.getAttribute("alt") ?? "").trim().length > 0).length,
    },
    hasViewportMeta,
    // Body-scoped: <head> has no visible text, and scoping here rather than
    // filtering keeps the rule obvious.
    text: textOf(root.querySelector("body") ?? documentEl),
  };
}
