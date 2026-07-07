/** HTML-level rich-text coercion so emitted plans validate against the slice
 *  models' StructuredText restrictions (heading slots are `single` and
 *  heading-restricted; body slots allow no headings — see Plan 4's field-type
 *  table). Blux markup is simple generated HTML, so tag rewriting is reliable. */

const BLOCK_RE = /<(h[1-6]|p|div)(\s[^>]*)?>[\s\S]*?<\/\1>/i;

/** Coerce a heading-slot HTML fragment to a single block whose tag is in
 *  `allowed` (e.g. ["h2","h3"]): keep an allowed tag, clamp other headings to
 *  the nearest allowed level, promote paragraphs/bare text to the LOWEST
 *  allowed heading. Only the first block survives (the fields are `single`). */
export function coerceHeadingHtml(html: string, allowed: string[]): string {
  const m = html.match(BLOCK_RE);
  const block = m ? m[0] : html;
  const tagMatch = block.match(/^<(h[1-6]|p|div)(\s[^>]*)?>/i);
  const tag = tagMatch?.[1]?.toLowerCase();
  if (tag && allowed.includes(tag)) return block;

  const levels = allowed.filter((t) => /^h[1-6]$/.test(t)).map((t) => Number(t[1]));
  const target =
    tag && tag.startsWith("h")
      ? `h${levels.reduce((b, l) => (Math.abs(l - Number(tag[1])) < Math.abs(b - Number(tag[1])) ? l : b))}`
      : `h${Math.max(...levels)}`;

  if (!tag) return `<${target}>${block}</${target}>`;
  return block
    .replace(new RegExp(`^<${tag}`, "i"), `<${target}`)
    .replace(new RegExp(`</${tag}>$`, "i"), `</${target}>`);
}

/** Demote all headings in a body-slot fragment to paragraphs (body fields
 *  allow no heading blocks). Attributes and inline markup pass through. */
export function demoteHeadingsHtml(html: string): string {
  return html.replace(/<(\/?)h[1-6](\s[^>]*)?>/gi, "<$1p$2>");
}
