/**
 * Shared HTML/XML escape. One implementation behind the dashboard renderers
 * (`src/dashboard/render.ts`, `fleet-render.ts`), the daily digest
 * (`src/reports/digest.ts`), and the MJML email templates
 * (`src/reports/*-email/template.ts`).
 *
 * The set is the strict-XML set (`& < > " '`), which is exactly what MJML's
 * `validationLevel: "strict"` parser needs and a superset of what plain HTML text
 * interpolation needs — so the SAME function serves both sinks. Site names
 * (e.g. "Brown & Co"), URLs, and operator commentary must not break the markup or
 * inject. The MJML templates re-export this as `escapeXml` for their callers.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Embed a value inside a `<script>` body as a JavaScript literal.
 *
 * **`escapeHtml` is the wrong tool here and fails in a way that looks like it
 * worked.** A `<script>` element's content is raw text: the HTML parser does not
 * decode entities inside it, so `&quot;` reaching the browser stays the six
 * characters `&quot;` — corrupting the JavaScript rather than escaping it. The
 * house style on these pages is "escapeHtml everything", so the first person to
 * interpolate into a script body will reach for it by reflex. This exists so
 * there is a correct thing to reach for instead.
 *
 * `JSON.stringify` produces a valid JS literal (quotes included — do NOT wrap the
 * result in quotes yourself). The extra replacements cover the two sequences JSON
 * does not escape but the HTML tokenizer still acts on inside raw text:
 *  - `</` would end the script element early, so `</script>` in a string closes
 *    the tag and spills the rest of the value into the document as markup;
 *  - `<!--` opens a comment-like state that can swallow the code after it.
 *
 * U+2028/U+2029 are escaped too: they are literal line terminators in JS source
 * and JSON.stringify leaves them raw.
 */
export function scriptLiteral(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Allow only http(s) URLs in an href context; everything else collapses to "#".
 *
 * Returns the PARSED, percent-encoded `u.href` — never the caller's raw string.
 * `new URL()` only validates the scheme; it does not sanitize the rest of the
 * string, so a well-formed https URL carrying a quote-breakout payload
 * (`https://x.example/"><script>...`) parses fine and, if handed back
 * verbatim, produces a live injection wherever a caller interpolates the
 * result into an href without a further escapeHtml pass. Returning `u.href`
 * closes that gap: the URL parser itself percent-encodes `"`, `<`, `>`, etc.
 * in the path/query. This also normalizes a bare-origin URL to carry a
 * trailing slash (`https://x.example` → `https://x.example/`) — a caller
 * that additionally wraps the result in escapeHtml (the majority pattern in
 * this repo) sees no behavior change beyond that encoding. */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // fall through
  }
  return "#";
}
