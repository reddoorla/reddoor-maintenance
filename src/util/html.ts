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
