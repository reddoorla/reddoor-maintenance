/**
 * Render the reply body's block/span AST to email-safe HTML.
 *
 * This is a WHITELIST renderer, and that is the entire point of the AST. The
 * envelope deliberately does not carry HTML: if it did, `parseReplyCopy` could
 * make no promise about what ends up in an email we send from a domain with
 * real sending reputation, and the day a site lets request data reach `_reply`
 * that becomes an injection vector in the worst possible place. Here the only
 * tags that can ever be emitted are the ones named below, so the worst a
 * hostile AST achieves is some bold text.
 *
 * Kept deliberately small for email clients: no images, no embeds, no classes,
 * no styles. Bold, italic, links, lists, two heading levels.
 */
import { escapeHtml } from "../util/html.js";
import type { ReplyBlock, ReplySpan } from "./reply-copy.js";

/** Schemes allowed in an href. Everything else is dropped and the text kept —
 *  a `javascript:` or `data:` URL arriving through a CMS field is not a link
 *  anyone meant to write. */
const SAFE_HREF = /^(https:\/\/|mailto:)/i;

const HEADING_TAG: Record<string, string> = { heading2: "h2", heading3: "h3" };

/** Wrap one already-escaped segment in the tags for the spans covering it.
 *  Link innermost so nested emphasis reads naturally in every client. */
function wrap(escaped: string, active: ReplySpan[]): string {
  let out = escaped;
  const link = active.find((s) => s.type === "link" && s.url && SAFE_HREF.test(s.url));
  if (link) out = `<a href="${escapeHtml(link.url as string)}">${out}</a>`;
  if (active.some((s) => s.type === "em")) out = `<em>${out}</em>`;
  if (active.some((s) => s.type === "strong")) out = `<strong>${out}</strong>`;
  return out;
}

/**
 * Apply spans to text by OFFSET, then escape — in that order, per segment.
 *
 * The order is the whole trick. Offsets index the raw string, so escaping first
 * and slicing after silently shifts every span past the first `&`, `<` or `>` —
 * the classic way this kind of renderer goes subtly wrong, bolding the wrong
 * words only in copy that happens to contain an ampersand.
 */
function renderText(text: string, spans: ReplySpan[] | undefined): string {
  const usable = (spans ?? [])
    // Clamp into range rather than trusting the CMS's arithmetic; drop anything
    // that still describes no characters.
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(text.length, s.end) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start < s.end);
  if (usable.length === 0) return escapeHtml(text);

  // Cut at every boundary, then decide which spans cover each piece. This is
  // what makes overlapping spans (bold across a range that a link only partly
  // covers) come out well-formed instead of interleaved.
  const bounds = new Set<number>([0, text.length]);
  for (const s of usable) {
    bounds.add(s.start);
    bounds.add(s.end);
  }
  const points = [...bounds].sort((a, b) => a - b);

  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    if (from === to) continue;
    const active = usable.filter((s) => s.start <= from && s.end >= to);
    out += wrap(escapeHtml(text.slice(from, to)), active);
  }
  return out;
}

const isListItem = (t: string): boolean => t === "list-item" || t === "o-list-item";

/** Blocks → HTML. Empty blocks are dropped; consecutive list items of the same
 *  kind collapse into a single list. */
export function renderBlocks(blocks: ReplyBlock[]): string {
  const usable = blocks.filter((b) => b.text.trim() !== "");
  let out = "";
  let openList: string | null = null;

  const closeList = () => {
    if (openList) {
      out += openList === "list-item" ? "</ul>" : "</ol>";
      openList = null;
    }
  };

  for (const block of usable) {
    const inner = renderText(block.text, block.spans);
    if (isListItem(block.type)) {
      if (openList !== block.type) {
        closeList();
        out += block.type === "list-item" ? "<ul>" : "<ol>";
        openList = block.type;
      }
      out += `<li>${inner}</li>`;
      continue;
    }
    closeList();
    const heading = HEADING_TAG[block.type];
    out += heading ? `<${heading}>${inner}</${heading}>` : `<p>${inner}</p>`;
  }
  closeList();
  return out;
}
