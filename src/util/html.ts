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

/** Allow only http(s) URLs in an href context; everything else collapses to "#". */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}
