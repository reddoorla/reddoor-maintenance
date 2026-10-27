// Emit-stage HTML sanitizer (slim plan 4b). Raw Blux html reaches three emit
// boundaries — cell `embed_html`, section `widget_html`, and BluxBlock payload
// `html` leaves — and the source markup routinely carries behavior <script>
// blocks (map init, clickMap toggles) that must never ship inside Prismic
// documents. The CatalogSpec upstream stays pristine (classify is
// emit-agnostic); sanitizing lives at the emit boundary only.

/** Closed `<script …>…</script>` blocks — case-insensitive, dotall, multiple. */
const SCRIPT_BLOCK_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
/** A script opened but never closed — swallow to end of input. */
const SCRIPT_TAIL_RE = /<script\b[\s\S]*$/i;
/** Inline `on*=` handler attributes (onclick, onerror, …), any quoting style. */
const ON_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
/** `javascript:` urls in href/src — quoted and bare forms. */
const JS_URL_QUOTED_RE = /\b(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi;
const JS_URL_BARE_RE = /\b(href|src)\s*=\s*javascript:[^\s>]*/gi;

/** Strip active content from raw html: `<script>` blocks (multiple,
 * case-insensitive, tolerating one left unclosed at EOF), inline `on*=`
 * handler attributes, and `javascript:` urls in href/src (neutralized to
 * `#`). Everything else passes through verbatim — the sanitizer is a
 * scalpel, not a rewriter. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(SCRIPT_BLOCK_RE, "")
    .replace(SCRIPT_TAIL_RE, "")
    .replace(ON_HANDLER_RE, "")
    .replace(JS_URL_QUOTED_RE, "$1=$2#$2")
    .replace(JS_URL_BARE_RE, '$1="#"');
}

/** Whether sanitized html still shows anything: non-whitespace text, or a
 * media element (img/iframe/video). A mount whose only payload was a behavior
 * script has no visible content — the emit layer drops it (recording a
 * diagnostic) instead of shipping an empty shell. */
export function hasVisibleContent(html: string): boolean {
  const clean = sanitizeHtml(html);
  if (/<(img|iframe|video)\b/i.test(clean)) return true;
  return clean.replace(/<[^>]*>/g, "").trim().length > 0;
}
