import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";
import { render } from "svelte/server";
import type { Component } from "svelte";

/**
 * The port's "no behaviour change" instrument for markup (#582). The old
 * renderers and the new pages are rendered from the same input and reduced to a
 * canonical form: one line per element (tag plus sorted, entity-decoded
 * attributes) and one per text run (decoded, whitespace collapsed). Two pages
 * are the same when their lines are.
 *
 * What the canonical form forgives, on purpose: attribute order and quoting,
 * entity spelling (`&#39;` and `'`), whitespace runs, whitespace at the start
 * and end of an element (Svelte drops it), comments (Svelte's hydration
 * markers), and `<script>` and `<style>`, which the port replaces wholesale and
 * whose behaviour the DOM tests cover instead. Everything a visitor sees or a
 * script selects on is compared.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** Elements whose layout ignores whitespace-only text beside them. */
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "ul",
]);
/** Containers whose whitespace-only children never render. */
const NO_TEXT = new Set(["table", "thead", "tbody", "tfoot", "tr", "select", "ul", "ol", "dl"]);

/** HTML whitespace, which collapses. Not `\s`: that also matches U+00A0, a
 *  no-break space, which renders and must stay distinct. */
const WS = /[ \t\n\r\f]+/g;
const isWs = (s: string) => s.replace(WS, "") === "";

/** Text compared verbatim, whitespace and all: a textarea's content, and the
 *  pre-formatted elements (`.subm-msg` is `white-space: pre-wrap`). */
function isVerbatim(el: HTMLElement): boolean {
  const tag = el.rawTagName?.toLowerCase();
  return tag === "textarea" || tag === "pre" || el.classList?.contains("subm-msg") === true;
}

const tagOf = (n: Node | undefined) =>
  n instanceof HTMLElement ? (n.rawTagName?.toLowerCase() ?? null) : null;

/** Whether a whitespace-only text node can affect layout: not inside table or
 *  list structure, and not beside a block-level element. */
function significantBlank(node: TextNode, siblings: Node[], i: number): boolean {
  const parent = tagOf(node.parentNode ?? undefined);
  if (parent && NO_TEXT.has(parent)) return false;
  const prev = siblings[i - 1];
  const next = siblings[i + 1];
  for (const n of [prev, next]) {
    const t = tagOf(n);
    if (t && BLOCK.has(t)) return false;
  }
  return true;
}

function canonicalLines(node: Node, depth: number, out: string[], verbatim = false): void {
  const pad = "  ".repeat(depth);
  if (node instanceof TextNode) {
    if (verbatim) {
      out.push(`${pad}${JSON.stringify(decodeEntities(node.rawText))}`);
      return;
    }
    const text = decodeEntities(node.rawText).replace(WS, " ");
    if (isWs(text)) {
      if (text !== "") out.push(`${pad}" "`);
      return;
    }
    out.push(`${pad}${JSON.stringify(text)}`);
    return;
  }
  if (!(node instanceof HTMLElement)) return; // comments
  const tag = node.rawTagName?.toLowerCase();
  if (tag === "script" || tag === "style") return;
  if (tag) {
    const attrs = Object.entries(node.rawAttributes)
      .map(([k, v]) => [k.toLowerCase(), decodeEntities(v ?? "")] as const)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    out.push(`${pad}<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`);
  }
  const inner = verbatim || (tag !== undefined && isVerbatim(node));
  // Edge whitespace is not compared here (Svelte trims it); whether it shows is
  // the text flow's question, below, where it collapses as the browser does.
  const children = mergeRuns(node.childNodes);
  const trimmed = inner ? children : trimEdges(children);
  trimmed.forEach((child, i) => {
    if (
      !inner &&
      child instanceof TextNode &&
      isWs(child.rawText) &&
      !significantBlank(child, trimmed, i)
    )
      return;
    canonicalLines(child, tag ? depth + 1 : depth, out, inner);
  });
}

/** Drop whitespace-only text at the start and end of a child list, and trim
 *  the outer edge of the first and last text runs, as Svelte does. */
function mergeRuns(nodes: Node[]): Node[] {
  // Comments, scripts and styles go first, and the text runs they separated
  // become one: Svelte's `<!--[-->` markers otherwise split one whitespace run
  // into several nodes, and the middle ones escape the "beside a block" rule.
  const isDropped = (n: Node) =>
    !(n instanceof TextNode) &&
    (!(n instanceof HTMLElement) || ["script", "style"].includes(tagOf(n) ?? ""));
  const list: Node[] = [];
  for (const n of nodes) {
    if (isDropped(n)) continue;
    const prev = list[list.length - 1];
    if (n instanceof TextNode && prev instanceof TextNode)
      list[list.length - 1] = new TextNode(prev.rawText + n.rawText, prev.parentNode);
    else list.push(n);
  }
  return list;
}

/** Drop whitespace at the start and end of a block element's children. */
function trimEdges(nodes: Node[]): Node[] {
  const list = [...nodes];
  const isBlank = (n: Node) => n instanceof TextNode && isWs(n.rawText);
  while (list.length && isBlank(list[0]!)) list.shift();
  while (list.length && isBlank(list[list.length - 1]!)) list.pop();
  const first = list[0];
  if (first instanceof TextNode)
    list[0] = new TextNode(first.rawText.replace(/^[ \t\n\r\f]+/, ""), first.parentNode);
  const last = list[list.length - 1];
  if (last instanceof TextNode)
    list[list.length - 1] = new TextNode(
      last.rawText.replace(/[ \t\n\r\f]+$/, ""),
      last.parentNode,
    );
  return list;
}

/**
 * The text a reader sees, in order: text runs with HTML whitespace collapsed
 * ACROSS inline boundaries (so "(30)<span> — x</span>" keeps its space and
 * "<span>x </span> y" shows one), a line break at each block boundary, and
 * verbatim text where whitespace is preserved. This is the half of the
 * comparison that edge whitespace inside inline elements cannot hide in.
 */
function textFlow(root: Node): string[] {
  // A block boundary; U+2029 never occurs in these pages' text.
  const BREAK = "\u2029";
  let flow = "";
  const walk = (node: Node, verbatim: boolean) => {
    if (node instanceof TextNode) {
      const t = decodeEntities(node.rawText);
      flow += verbatim ? t.replace(/\n/g, "\u2424") : t;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = tagOf(node);
    if (tag === "script" || tag === "style") return;
    // An option is its own line: whitespace between options never renders.
    const block = tag !== null && (BLOCK.has(tag) || tag === "option");
    if (block) flow += BREAK;
    for (const child of node.childNodes) walk(child, verbatim || isVerbatim(node));
    if (block) flow += BREAK;
  };
  walk(root, false);
  return flow
    .split(BREAK)
    .map((line) => line.replace(WS, " ").trim())
    .filter((line) => line !== "");
}

/** Canonical lines for an HTML fragment, after removing every element that
 *  matches one of `drop` (CSS selectors): its structure, then its text flow. */
export function canonical(html: string, drop: string[] = []): string[] {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  for (const sel of drop) for (const el of root.querySelectorAll(sel)) el.remove();
  const out: string[] = [];
  canonicalLines(root, 0, out);
  out.push("--- text flow ---", ...textFlow(root).map((l) => `| ${l}`));
  // Adjacent text runs (split by a removed comment or element) are one run.
  const merged: string[] = [];
  for (const line of out) {
    const prev = merged[merged.length - 1];
    const indent = line.length - line.trimStart().length;
    if (
      prev !== undefined &&
      line.trimStart().startsWith('"') &&
      prev.trimStart().startsWith('"') &&
      prev.length - prev.trimStart().length === indent
    ) {
      const a = JSON.parse(prev.trimStart()) as string;
      const b = JSON.parse(line.trimStart()) as string;
      merged[merged.length - 1] = " ".repeat(indent) + JSON.stringify((a + b).replace(WS, " "));
    } else merged.push(line);
  }
  return merged;
}

/** The `<body>` of a whole old-renderer document. */
export function bodyOf(doc: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc);
  if (!m) throw new Error("no <body> in document");
  return m[1]!;
}

/** Server-render a page component, as SvelteKit does, and return its body. */
export function renderPage<P extends Record<string, unknown>>(
  page: Component<P>,
  props: P,
): string {
  return render(page, { props }).body;
}
