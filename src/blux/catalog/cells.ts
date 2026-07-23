import type { Media, Node, GridToken } from "../grid/types.js";
import { collectMedia, blockPlainText } from "../grid/index.js";
// `collectText`/`isEmptyRaw` are not re-exported via the grid barrel
// (index.ts) — import them from their module directly.
import { collectText, isEmptyRaw } from "../grid/classify-band.js";
import { mediaCdnUrl } from "../emit/grid-plan.js";
import type { BlockNode, CatalogCell } from "./spec.js";

/** Peel one-child style-box stacks (mirror of classify-band unboxed). */
function unbox(n: Node): Node {
  let cur = n;
  while (cur.kind === "stack" && cur.children.length === 1) {
    const only = cur.children[0];
    if (!only) break;
    cur = only;
  }
  return cur;
}

/** Raw nodes under a node (recursive). classify-band has the same helper but
 * does not export it — reimplemented locally rather than widening the grid
 * module's public surface. */
function collectRaws(node: Node): Extract<Node, { kind: "raw" }>[] {
  switch (node.kind) {
    case "raw":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectRaws(c.node));
    case "stack":
      return node.children.flatMap(collectRaws);
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
      return [];
  }
}

/** The joined non-empty raw html under a node — a cell's `embedHtml`. Keeps
 * the visible runs the text model would otherwise drop (the-pointe's 'Visit
 * Website' link buttons parse to `raw`); empty raws are client-mount shells. */
function rawHtmlOf(node: Node): string | undefined {
  const raws = collectRaws(node).filter((r) => !isEmptyRaw(r));
  return raws.length ? raws.map((r) => r.html).join("\n") : undefined;
}

/** Wrap BARE (untagged) html in `<p>` — html whose trimmed text does not start
 * with `<`. Body parts folded next to a wrapped `<hN>` heading MUST carry a
 * block tag of their own: `htmlAsRichText` merges trailing bare text INTO the
 * preceding heading node, concatenating the words and dropping the paragraph.
 * Already-tagged parts (wrapped headings, `<p>`-carrying body html, raw block
 * html) pass through untouched. */
function wrapBare(html: string): string {
  return html.trim().startsWith("<") ? html : `<p>${html.trim()}</p>`;
}

/** Per-cell visual fields recovered from the grid token + the (unboxed) node's
 * card style. `token.ratio` is the cell's width share; card keys land on
 * `node.style` via parse-grid's withCardStyle. */
function visualFieldsOf(u: Node, token?: GridToken): Partial<CatalogCell> {
  const style = "style" in u && u.style ? u.style : {};
  const media = collectMedia(u)[0];
  const out: Partial<CatalogCell> = {};
  if (typeof token?.ratio === "number") out.width = `${token.ratio}%`;
  if (typeof token?.spacing === "number") out.spacing = token.spacing;
  if (style["background-color"]) out.backgroundColor = style["background-color"];
  if (style["padding"]) out.contentPadding = style["padding"];
  if (style["_valign"] === "middle") out.valign = true;
  if (style["_fill"] === "column" || media?.fit === "cover") out.cover = true;
  return out;
}

/** Title + body html under a node (recursive, document order). The FIRST
 * non-blank heading becomes the title; every LATER heading is folded into the
 * body parts in document order relative to bodies/subtitles, so no heading is
 * dropped. The parser's `heading.html` carries no `<hN>` wrapper, so headings
 * are wrapped here — otherwise `htmlAsRichText` resolves them to `paragraph`
 * nodes, violating heading-only StructuredText fields and losing levels.
 * Folded headings keep their TRUE level (body fields render every block kind;
 * clamping to a field's heading window is emit's concern); bare body html is
 * `<p>`-wrapped so a folded heading never swallows it (see `wrapBare`). */
function textOf(n: Node): {
  title?: string;
  body?: string;
  titleRole?: string;
  bodyRole?: string;
} {
  let title: string | undefined;
  let titleRole: string | undefined;
  const bodyParts: string[] = [];
  let bodyRole: string | undefined;
  for (const t of collectText(n)) {
    if (t.kind === "heading") {
      if (blockPlainText(t.html) === "") continue; // whitespace-only heading
      const wrapped = `<h${t.level}>${t.html}</h${t.level}>`;
      if (title === undefined) {
        title = wrapped;
        titleRole = t.role;
      } else bodyParts.push(wrapped);
    } else if (t.kind === "body") {
      if (t.html) {
        bodyParts.push(wrapBare(t.html));
        bodyRole ??= t.role;
      }
    } else if (t.kind === "subtitle") {
      bodyParts.push(`<p>${t.text}</p>`);
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(bodyParts.length ? { body: bodyParts.join("\n") } : {}),
    ...(titleRole ? { titleRole } : {}),
    ...(bodyRole ? { bodyRole } : {}),
  };
}

/** Shared build state: `flattened` records that a subgrid item's subtree
 * carried structure the cell model cannot store — a nested row (at any depth
 * under the item) or more than one media (see `cellDepthExceedsTwo`). */
type CellBuildState = { flattened: boolean };

/** Whether a subtree contains any row, at any depth. */
function containsRow(node: Node): boolean {
  switch (node.kind) {
    case "row":
      return true;
    case "stack":
      return node.children.some(containsRow);
    default:
      return false;
  }
}

/** One node → one catalog cell. `depth` 0 builds a top-level cell: a row
 * becomes a subgrid (the ONE nesting level the Prismic model stores), and any
 * OTHER subtree carrying MORE than one media splits into a subgrid of one
 * text item (the whole subtree's title/body/raw html) plus one media item per
 * media in document order — the band stays editable and no media is dropped.
 * At subgrid-item depth (1) neither trick is available: a subtree with a
 * nested row or a second media cannot be stored, so its content is flattened
 * into the cell (first media + all text + raws) and the loss is recorded on
 * `state` — builder and guard can never disagree on legality. */
function buildCell(
  node: Node,
  depth: number,
  state: CellBuildState,
  token?: GridToken,
): CatalogCell {
  const u = unbox(node);
  if (u.kind === "row" && depth === 0) {
    return {
      kind: "subgrid",
      subgrid: u.cells.map((c) => buildCell(c.node, depth + 1, state, c.token)),
    };
  }
  const allMedia = collectMedia(u);
  if (depth === 0 && allMedia.length > 1) {
    // Depth-0 subgrid split: every media survives as its own item; the
    // subtree's whole text/raw content rides one leading text item.
    const { title, body } = textOf(u);
    const embedHtml = rawHtmlOf(u);
    const textItem: CatalogCell[] =
      title || body || embedHtml
        ? [
            {
              kind: "text",
              ...(title ? { title } : {}),
              ...(body ? { body } : {}),
              ...(embedHtml ? { embedHtml } : {}),
            },
          ]
        : [];
    return {
      kind: "subgrid",
      subgrid: [...textItem, ...allMedia.map((m): CatalogCell => ({ kind: "media", media: m }))],
    };
  }
  if (depth > 0 && (allMedia.length > 1 || containsRow(u))) state.flattened = true;
  const media = allMedia[0];
  const vis = visualFieldsOf(u, token);
  const { title, body, titleRole, bodyRole } = textOf(u);
  const embedHtml = rawHtmlOf(u);
  if (u.kind === "media" || (media && !title && !body)) {
    return {
      kind: "media",
      ...(media ? { media } : {}),
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(embedHtml ? { embedHtml } : {}),
      ...(titleRole ? { titleRole } : {}),
      ...(bodyRole ? { bodyRole } : {}),
      ...vis,
    };
  }
  return {
    kind: title || body ? "text" : embedHtml ? "embed" : "text",
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(media ? { media } : {}),
    ...(embedHtml ? { embedHtml } : {}),
    ...(titleRole ? { titleRole } : {}),
    ...(bodyRole ? { bodyRole } : {}),
    ...vis,
  };
}

/** One node → one catalog cell (public wrapper; the cell is top-level). */
export function cellFromNode(node: Node): CatalogCell {
  return buildCell(node, 0, { flattened: false });
}

function buildCells(node: Node, state: CellBuildState): CatalogCell[] {
  const u = unbox(node);
  if (u.kind === "row") return u.cells.map((c) => buildCell(c.node, 0, state, c.token));
  if (u.kind === "stack") return u.children.map((c) => buildCell(c, 0, state));
  return [buildCell(u, 0, state)];
}

/** A row's cells → catalog cells; a bare content node → a single cell. Never
 * emits a subgrid item that itself has a subgrid (rows past that depth are
 * flattened — see `buildCell`). */
export function nodeToCells(node: Node): CatalogCell[] {
  return buildCells(node, { flattened: false });
}

/** True when `node` needs more nesting than the cell model stores — i.e.
 * building its cells would flatten structure at subgrid-item depth (a nested
 * row anywhere under one item, or a second media inside one item). Implemented
 * BY running the builder, so guard and emission share one source of truth:
 * guard false ⟹ every media and text run in the band is present in the
 * emitted cells (structure-complete up to the cell→subgrid model);
 * guard true ⟹ the caller should fall back to BluxBlock (content-preserving). */
export function cellDepthExceedsTwo(node: Node): boolean {
  const state: CellBuildState = { flattened: false };
  buildCells(node, state);
  return state.flattened;
}

/** Serialize a node tree to a BluxBlock payload — the content-preserving
 * fallback for bands too deep/irregular for the cell model. Never drops media
 * or text (the whole point). */
export function blockPayload(node: Node): BlockNode {
  const u = node;
  switch (u.kind) {
    case "row":
      return {
        tag: "div",
        style: { display: "grid" },
        children: u.cells.map((c) => blockPayload(c.node)),
      };
    case "stack":
      return { tag: "div", children: u.children.map(blockPayload) };
    case "heading":
      return { tag: `h${u.level}`, html: u.html };
    case "body":
      return { tag: "div", html: u.html };
    case "subtitle":
      return { tag: "p", html: u.text };
    case "media":
      return mediaBlock(u.media);
    case "raw":
      return { html: u.html };
    case "widget":
      return { tag: "div", html: "" }; // 4b captures widget html
  }
}

function mediaBlock(m: Media): BlockNode {
  // A video renders as an inline <video> — an image url here would make the
  // starter's BluxBlock render a broken <img> pointing at an mp4.
  if (m.kind === "video") return { tag: "figure", html: videoTag(m) };
  const url = m.base ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}` : m.assetId;
  // `Media` (grid/types.ts) carries no alt — asset alt lives in the IR asset
  // index and is resolved at emit/migrate time, not here.
  return { tag: "figure", image: { url, alt: "" } };
}

/** An inline `<video>` tag for a video Media — shared by the emit layer
 * (`embed_html`/`video_embed` fields) and the BluxBlock payload. Videos cannot
 * ride Prismic Image fields (PrismicImage would render a broken <img>) — they
 * play from the export's CDN url instead (self-hosted upload pends the 4d
 * asset strategy; url logic mirrors `mediaCdnUrl`, bare assetId as last
 * resort). Attributes honor the source `<video>` semantics (`Media.playback`);
 * absent playback falls back to a user-initiated inline video
 * (`controls playsinline`). Autoplay implies `muted` (browsers refuse un-muted
 * autoplay) and `playsinline` (iOS refuses inline autoplay without it). */
export function videoTag(m: Media): string {
  const p = m.playback ?? { controls: true, playsinline: true };
  const attrs: string[] = [];
  if (p.autoplay) attrs.push("autoplay");
  if (p.loop) attrs.push("loop");
  if (p.muted || p.autoplay) attrs.push("muted");
  if (p.controls) attrs.push("controls");
  if (p.playsinline || p.autoplay) attrs.push("playsinline");
  const src = `src="${mediaCdnUrl(m) ?? m.assetId}"`;
  return `<video ${[...attrs, src].join(" ")}></video>`;
}
