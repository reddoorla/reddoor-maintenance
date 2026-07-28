import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { RtBlock, RtSpan } from "./types.js";

/** Convert simple Webflow rich-text HTML to Prismic StructuredText blocks.
 *  Supported: p, ul/ol>li, h1-h6 (→ paragraph — the entity `body` field allows
 *  no headings), strong/b, em/i, a, br (→ single space). Unknown wrappers
 *  recurse; unknown leaves contribute their text. Zero-width/blank blocks are
 *  dropped, and each block's text is trimmed (leading/trailing whitespace and
 *  zero-width chars) with span offsets remapped to match.
 *  Known limitations: bare top-level text outside any block element is
 *  dropped; nested lists flatten (neither occurs in Webflow rich-text
 *  output). */
export function htmlToRichText(html: string): RtBlock[] {
  const root = parse(html);
  const blocks: RtBlock[] = [];
  collectBlocks(root, undefined, blocks);
  return blocks;
}

const HEADING_RE = /^h[1-6]$/;
// Webflow spacer paragraphs are a lone zero-width space/non-joiner/joiner or
// BOM character; strip those before deciding whether a block is "empty".
// Built from char codes (not a literal/regex-escaped class) to keep these
// invisible code points out of the source text.
const ZERO_WIDTH_CODES = [0x200b, 0x200c, 0x200d, 0xfeff];

function isZeroWidth(ch: string): boolean {
  return ZERO_WIDTH_CODES.includes(ch.charCodeAt(0));
}

/** Clean a block's accumulated text — drop leading whitespace/zero-width
 *  chars, collapse whitespace runs left at node boundaries, trim the tail —
 *  remapping every span's offsets onto the cleaned text. Dropped characters
 *  map to the position of the next kept character, so a span that begins on a
 *  collapsed space starts on the following word; spans that collapse to
 *  nothing are dropped. */
function normalizeBlock(text: string, spans: RtSpan[]): { text: string; spans: RtSpan[] } {
  // map[i] = index in the cleaned string where old position i lands.
  const map: number[] = new Array<number>(text.length + 1);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    map[i] = out.length;
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      if (out === "" || out.endsWith(" ")) continue; // trim leading + collapse runs
      out += " ";
    } else if (isZeroWidth(ch) && out === "") {
      continue; // leading zero-width spacer chars
    } else {
      out += ch;
    }
  }
  map[text.length] = out.length;
  let end = out.length;
  while (end > 0 && (/\s/.test(out.charAt(end - 1)) || isZeroWidth(out.charAt(end - 1)))) end--;
  out = out.slice(0, end);
  const remapped: RtSpan[] = [];
  for (const span of spans) {
    const start = Math.min(map[span.start] ?? out.length, out.length);
    const spanEnd = Math.min(map[span.end] ?? out.length, out.length);
    if (spanEnd > start) remapped.push({ ...span, start, end: spanEnd });
  }
  return { text: out, spans: remapped };
}

/** Element check: TextNode's rawTagName is always "" (falsy) in
 *  node-html-parser, so a truthy rawTagName means an HTMLElement. */
function isElement(node: Node): node is HTMLElement {
  return Boolean(node.rawTagName);
}

/** Walk the DOM looking for block-level elements (p/h1-6, li under a ul/ol).
 *  `listType` tracks which list-item variant an enclosing <ul>/<ol> implies;
 *  unrecognized wrappers (div, section, …) are recursed into so nested
 *  markup still yields blocks. */
function collectBlocks(
  parent: HTMLElement,
  listType: "list-item" | "o-list-item" | undefined,
  blocks: RtBlock[],
): void {
  for (const node of parent.childNodes) {
    if (!isElement(node)) continue;
    const tag = node.rawTagName.toLowerCase();
    if (tag === "p" || HEADING_RE.test(tag)) {
      addBlock(node, "paragraph", blocks);
    } else if (tag === "ul") {
      collectBlocks(node, "list-item", blocks);
    } else if (tag === "ol") {
      collectBlocks(node, "o-list-item", blocks);
    } else if (tag === "li" && listType) {
      addBlock(node, listType, blocks);
    } else {
      collectBlocks(node, listType, blocks);
    }
  }
}

function addBlock(el: HTMLElement, type: RtBlock["type"], blocks: RtBlock[]): void {
  const raw = walkInline(el);
  const { text, spans } = normalizeBlock(raw.text, raw.spans);
  if (text === "") return;
  blocks.push({ type, text, spans: mergeAdjacentSpans(spans) });
}

/** Walk a block's inline content, accumulating the final text string and
 *  spans whose offsets index into that final string. Recurses into nested
 *  elements first so a span's start/end are computed from the length of the
 *  text already accumulated (start = length before, end = length after). */
function walkInline(el: HTMLElement): { text: string; spans: RtSpan[] } {
  let text = "";
  const spans: RtSpan[] = [];

  for (const node of el.childNodes) {
    if (!isElement(node)) {
      text += decodeEntities(node.rawText).replace(/\s+/g, " ");
      continue;
    }

    const tag = node.rawTagName.toLowerCase();
    if (tag === "br") {
      // line break → single space; normalizeBlock collapses any run this
      // creates against adjacent whitespace, so no double space survives.
      text += " ";
      continue;
    }
    const start = text.length;
    const inner = walkInline(node);
    for (const span of inner.spans) {
      spans.push(shiftSpan(span, start));
    }
    text += inner.text;
    const end = text.length;

    if (tag === "strong" || tag === "b") {
      spans.push({ start, end, type: "strong" });
    } else if (tag === "em" || tag === "i") {
      spans.push({ start, end, type: "em" });
    } else if (tag === "a") {
      spans.push({
        start,
        end,
        type: "hyperlink",
        data: { link_type: "Web", url: node.getAttribute("href") ?? "" },
      });
    }
    // unknown wrapper (span, br, …): its text/spans are already merged in above
  }

  return { text, spans };
}

function shiftSpan(span: RtSpan, offset: number): RtSpan {
  return { ...span, start: span.start + offset, end: span.end + offset };
}

/** Collapse contiguous same-type spans (e.g. two adjacent <strong> runs)
 *  into one, so downstream consumers never see touching duplicate spans. */
function mergeAdjacentSpans(spans: RtSpan[]): RtSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RtSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === span.type && prev.end === span.start && sameSpanData(prev, span)) {
      merged[merged.length - 1] = { ...prev, end: span.end };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

function sameSpanData(a: RtSpan, b: RtSpan): boolean {
  if (a.type === "hyperlink" && b.type === "hyperlink") return a.data.url === b.data.url;
  return a.type === b.type;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** Decode the entities Webflow's rich text emits: named (&amp; &lt; &gt;
 *  &quot; &apos; &nbsp; plus the typographic set — curly quotes, dashes,
 *  ellipsis) and numeric (&#39; &#x27;). Unrecognized entities are left
 *  as-is. */
function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}
