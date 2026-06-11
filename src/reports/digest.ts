// src/reports/digest.ts
import type { ReportType } from "./types.js";

/** One report awaiting the operator's "yes" — site, type, period, and a link to its
 *  dashboard page (the digest LINKS to the dashboard; it never carries the approve action,
 *  because email scanners pre-fetch links and would trip accidental approvals). */
export type ReadyItem = {
  siteName: string;
  reportType: ReportType;
  /** "YYYY-MM" — the Period key from the Reports row. */
  period: string;
  /** Absolute URL to /s/<slug> on the dashboard. */
  dashboardUrl: string;
};

/**
 * One "Needs attention" entry. The M5 SEAM: M5 plugs detectors (Renovate failures,
 * new vulns, lighthouse regressions, delivery bounces) in by pushing typed items here.
 * `kind` is a discriminant so M5 can add variants without breaking the renderer; for M3
 * we render the generic title+url shape, which covers open `*-failing` tracking issues.
 */
export type AttentionItem = {
  kind: string;
  title: string;
  /** Optional URL rendered as a hyperlink on the title. */
  url?: string;
};

/** Input shape for `renderDigestHtml`. Both arrays are required; callers pass `[]` for
 *  empty sections — the renderer handles the empty-state copy. */
export type DigestSections = {
  readyForYourYes: ReadyItem[];
  needsAttention: AttentionItem[];
};

/** Escape a string before interpolating into the digest HTML. Mirrors the report
 *  template's escapeXml — site names (e.g. "Brown & Co") and operator text must not
 *  break the markup or inject. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const GREY = "#757575";
const RED = "#C00";

function readySection(items: ReadyItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Ready for your yes</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">Nothing waiting on you.</p>`;
  }
  const rows = items
    .map(
      (it) => `
      <li style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;margin-bottom:8px">
        <strong style="color:#222">${esc(it.siteName)}</strong> — ${esc(it.reportType)} (${esc(it.period)})
        — <a href="${esc(it.dashboardUrl)}" style="color:${RED}">review &amp; approve</a>
      </li>`,
    )
    .join("");
  return `${heading}<ul style="padding-left:20px;margin:0">${rows}</ul>`;
}

function attentionSection(items: AttentionItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }
  const rows = items
    .map((it) => {
      const label = it.url
        ? `<a href="${esc(it.url)}" style="color:${RED}">${esc(it.title)}</a>`
        : esc(it.title);
      return `<li style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;margin-bottom:8px">${label}</li>`;
    })
    .join("");
  return `${heading}<ul style="padding-left:20px;margin:0">${rows}</ul>`;
}

/** Pure render of the unified daily operator digest. No IO — the caller (runDigest)
 *  collects the rows and decides whether to send. */
export function renderDigestHtml(sections: DigestSections): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#ffffff">
    <h1 style="color:${RED};font-family:helvetica,sans-serif;font-size:24px;font-weight:700;margin:0 0 8px">Your fleet today</h1>
    ${readySection(sections.readyForYourYes)}
    ${attentionSection(sections.needsAttention)}
  </body>
</html>`;
}
