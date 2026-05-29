import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { relativeTimeFromNow } from "./relative-time.js";

/** Minimal HTML-escape; not for XML/attribute-edge cases, just for text + safe
 *  attribute interpolation here. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allow only http(s) URLs in href context; everything else collapses to "#". */
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    // fall through
  }
  return "#";
}

function scoreTile(label: string, value: number | null): string {
  const display = value === null ? "—" : String(value);
  return `<div class="tile"><div class="tile-value">${escapeHtml(display)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

function healthTile(label: string, value: number | null, sub: string | null): string {
  const display = value === null ? "—" : String(value);
  const subLine = sub ? `<div class="tile-sub">${escapeHtml(sub)}</div>` : "";
  return `<div class="tile"><div class="tile-value">${escapeHtml(display)}</div><div class="tile-label">${escapeHtml(label)}</div>${subLine}</div>`;
}

function depsSub(majorBehind: number | null): string | null {
  if (majorBehind === null || majorBehind === 0) return null;
  return `${majorBehind} major behind`;
}

function securityTotal(site: WebsiteRow): number | null {
  const parts = [
    site.securityVulnsCritical,
    site.securityVulnsHigh,
    site.securityVulnsModerate,
    site.securityVulnsLow,
  ];
  if (parts.every((p) => p === null)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

function securitySub(site: WebsiteRow): string | null {
  const total = securityTotal(site);
  if (total === null || total === 0) return null;
  const c = site.securityVulnsCritical ?? 0;
  const h = site.securityVulnsHigh ?? 0;
  const m = site.securityVulnsModerate ?? 0;
  const l = site.securityVulnsLow ?? 0;
  return `${c}C / ${h}H / ${m}M / ${l}L`;
}

function reportRow(r: ReportRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : "—";
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${link}</td></tr>`;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 2rem; }
.meta a { color: inherit; }
.audited { color: #999; font-size: 0.85rem; margin-bottom: 1.5rem; }
.section { margin: 2rem 0; }
.section h2 { font-size: 1.1rem; margin: 0 0 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.tile { padding: 1rem; border: 1px solid #ddd; border-radius: 6px; text-align: center; }
@media (prefers-color-scheme: dark) { .tile { border-color: #333; } }
.tile-value { font-size: 2rem; font-weight: 600; }
.tile-label { font-size: 0.85rem; color: #666; margin-top: 0.25rem; }
.tile-sub { font-size: 0.75rem; color: #999; margin-top: 0.15rem; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { th, td { border-color: #2a2a2a; } }
.muted { color: #999; }
.empty { color: #999; padding: 1rem; border: 1px dashed #ccc; border-radius: 6px; text-align: center; }
`;

/**
 * Render the per-site dashboard as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * fetches data, then hands it here. Easier to unit-test, easier to render
 * a static preview from CLI later.
 */
export function renderSiteDashboardHtml(site: WebsiteRow, reports: ReportRow[]): string {
  const name = escapeHtml(site.name);
  const urlSafe = safeUrl(site.url);
  const allScoresNull =
    site.pScore === null && site.rScore === null && site.bpScore === null && site.seoScore === null;

  const scoresSection = allScoresNull
    ? `<div class="empty">No lighthouse data yet — run <code>reddoor-maint audit --write-airtable</code> from the site checkout.</div>`
    : `<div class="tiles">
        ${scoreTile("Performance", site.pScore)}
        ${scoreTile("Accessibility", site.rScore)}
        ${scoreTile("Best Practices", site.bpScore)}
        ${scoreTile("SEO", site.seoScore)}
      </div>`;

  const secTotal = securityTotal(site);
  const allHealthNull =
    site.a11yViolations === null && site.depsDrifted === null && secTotal === null;
  const healthSection = allHealthNull
    ? `<div class="empty">No health data yet — run <code>reddoor-maint audit --write-airtable</code> from the site checkout.</div>`
    : `<div class="tiles">
        ${healthTile("Accessibility issues", site.a11yViolations, null)}
        ${healthTile("Dependency updates", site.depsDrifted, depsSub(site.depsMajorBehind))}
        ${healthTile("Security alerts", secTotal, securitySub(site))}
      </div>`;

  const auditedLine = site.lastLighthouseAuditAt
    ? `<div class="audited">Last audited ${escapeHtml(relativeTimeFromNow(site.lastLighthouseAuditAt))}</div>`
    : "";

  const reportsSection =
    reports.length === 0
      ? `<div class="empty">No reports yet.</div>`
      : `<table>
          <thead><tr><th>Completed</th><th>Type</th><th>ID</th><th>Report</th></tr></thead>
          <tbody>${reports.map(reportRow).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name} — Reddoor maintenance</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>${name}</h1>
  <div class="meta"><a href="${escapeHtml(urlSafe)}">${escapeHtml(site.url)}</a></div>
  ${auditedLine}

  <div class="section">
    <h2>Lighthouse</h2>
    ${scoresSection}
  </div>

  <div class="section">
    <h2>Site Health</h2>
    ${healthSection}
  </div>

  <div class="section">
    <h2>Reports</h2>
    ${reportsSection}
  </div>
</body>
</html>`;
}
