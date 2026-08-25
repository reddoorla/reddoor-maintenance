import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { PageExtract } from "./types.js";

/** Tags whose subtree text a human reader never sees. HEAD is included so the
 *  `<title>` doesn't leak into the body text the JS-dependence diff measures. */
const NON_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

type Collected = {
  metas: HTMLElement[];
  links: HTMLElement[];
  jsonLd: string[];
  images: HTMLElement[];
  headings: { level: number; text: string }[];
  title: string | null;
  textParts: string[];
};

function collect(el: HTMLElement, out: Collected, inNonText: boolean): void {
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      if (!inNonText) {
        const t = collapse(child.text);
        if (t) out.textParts.push(t);
      }
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    const tag = e.tagName;
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
        break;
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = collapse(e.text);
        if (text) out.headings.push({ level: Number(tag.slice(1)), text });
        break;
      }
    }
    collect(e, out, inNonText || NON_TEXT.has(tag));
  }
}

/** Parse one HTML document into the signals every downstream check reads.
 *  Pure — the same input always yields the same extract. */
export function extractPage(html: string): PageExtract {
  const out: Collected = {
    metas: [],
    links: [],
    jsonLd: [],
    images: [],
    headings: [],
    title: null,
    textParts: [],
  };
  const root = parse(html);
  // node-html-parser surfaces `<!doctype html>` as a TEXT node that is a SIBLING
  // of <html>, not a doctype node, so walking the parse root would count the
  // declaration as visible copy. Walk from <html> when there is one; a fragment
  // has no doctype to skip.
  collect(root.querySelector("html") ?? root, out, false);

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
    text: out.textParts.join(" "),
  };
}
