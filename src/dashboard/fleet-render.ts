import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}

function scoreCell(value: number | null): string {
  const display = value === null ? "—" : String(value);
  return `<td class="score">${escapeHtml(display)}</td>`;
}

function siteHrefCell(site: WebsiteRow): string {
  const name = escapeHtml(site.name);
  // Caller is responsible for filtering — render assumes every site has a
  // dashboardToken (anything in Airtable without one isn't on the Reddoor
  // stack and shouldn't appear). The `?? ""` is a defensive nudge if a
  // misuse ever slips through; non-null guarantee belongs upstream.
  const token = site.dashboardToken ?? "";
  const href = `/s/${escapeHtml(siteSlug(site.name))}?t=${escapeHtml(token)}`;
  return `<td class="site"><a href="${href}">${name}</a></td>`;
}

function siteRow(site: WebsiteRow): string {
  return `<tr>
    ${siteHrefCell(site)}
    <td><a href="${escapeHtml(safeUrl(site.url))}" class="url" target="_blank" rel="noopener">${escapeHtml(site.url)}</a></td>
    ${scoreCell(site.pScore)}
    ${scoreCell(site.rScore)}
    ${scoreCell(site.bpScore)}
    ${scoreCell(site.seoScore)}
  </tr>`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 2rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th { text-align: left; padding: 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 2px solid #ddd; }
@media (prefers-color-scheme: dark) { th { border-color: #333; } }
td { padding: 0.65rem 0.5rem; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { td { border-color: #2a2a2a; } }
td.site a { font-weight: 500; }
td.url { color: #666; font-size: 0.85rem; }
td.score { text-align: right; font-variant-numeric: tabular-nums; min-width: 3.5rem; }
.empty { color: #999; padding: 2rem; text-align: center; border: 1px dashed #ccc; border-radius: 6px; }
`;

/**
 * Render the fleet homepage as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * filters the Websites rows (drops anything without a dashboardToken — those
 * aren't on the Reddoor stack), sorts, and hands here. Same style vocabulary
 * as renderSiteDashboardHtml so the two pages feel like one product.
 */
export function renderFleetHomeHtml(sites: WebsiteRow[]): string {
  const body =
    sites.length === 0
      ? `<div class="empty">No sites to display.</div>`
      : `<table>
          <thead><tr>
            <th>Site</th>
            <th>URL</th>
            <th>Perf</th>
            <th>A11y</th>
            <th>BP</th>
            <th>SEO</th>
          </tr></thead>
          <tbody>${sites.map(siteRow).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddoor maintenance — fleet</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet</h1>
  <div class="meta">${sites.length} site${sites.length === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${body}
</body>
</html>`;
}
