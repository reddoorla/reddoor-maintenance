import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { isPendingApproval } from "../reports/airtable/reports.js";
import type { SubmissionRow } from "../reports/airtable/submissions.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

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

function pendingRow(r: ReportRow): string {
  const type = escapeHtml(r.reportType);
  const period = r.period ? escapeHtml(r.period) : "—";
  return `<li><strong>${type}</strong> <span class="muted">${period}</span> <button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="/api/reports/${encodeURIComponent(r.id)}/approve">Approve</button></li>`;
}

function pendingSection(reports: ReportRow[]): string {
  const pending = reports.filter(isPendingApproval);
  if (pending.length === 0) return "";
  return `<div class="section pending">
    <h2>Pending your yes (${pending.length})</h2>
    <ul class="pending-list">${pending.map(pendingRow).join("")}</ul>
  </div>`;
}

function reportRow(r: ReportRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : "—";
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  const action = isPendingApproval(r)
    ? `<button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="/api/reports/${encodeURIComponent(r.id)}/approve">Approve</button>`
    : "";
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${link}</td><td>${action}</td></tr>`;
}

function submissionRow(s: SubmissionRow): string {
  const when = s.submittedAt ? escapeHtml(relativeTimeFromNow(s.submittedAt)) : "—";
  const type = escapeHtml(s.formType);
  const who = escapeHtml(s.name || "(no name)");
  const email = escapeHtml(s.email || "");
  const message = escapeHtml(s.message ?? "");
  const status = escapeHtml(s.status);
  const id = escapeHtml(s.id);
  const url = `/api/submissions/${encodeURIComponent(s.id)}/status`;
  const btn = (label: string, action: string) =>
    `<button class="subm-status" data-id="${id}" data-status="${action}" data-url="${url}">${label}</button>`;
  return `<li class="subm-item">
    <div class="subm-head"><strong>${type}</strong> · ${who} <span class="muted">${email}</span> <span class="pill subm-${status}">${status}</span> <span class="muted">${when}</span></div>
    ${message ? `<div class="subm-msg">${message}</div>` : ""}
    <div class="subm-actions">${btn("Read", "read")}${btn("Archive", "archived")}${btn("Spam", "spam")}</div>
  </li>`;
}

function submissionsSection(submissions: SubmissionRow[]): string {
  if (submissions.length === 0) return "";
  const recent = [...submissions]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, 25);
  return `<div class="section submissions">
    <h2>Form submissions (${submissions.length})</h2>
    <ul class="subm-list">${recent.map(submissionRow).join("")}</ul>
  </div>`;
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
button.approve { font: inherit; padding: 0.35rem 0.85rem; border: 1px solid #2c7; border-radius: 6px; background: #2c7; color: #fff; cursor: pointer; }
button.approve:disabled { opacity: 0.6; cursor: default; }
.pending-list { list-style: none; padding: 0; margin: 0; }
.pending-list li { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #eee; }
.pill { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 700; }
.subm-list { list-style: none; padding: 0; margin: 0; }
.subm-item { padding: 0.6rem 0; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { .subm-item { border-color: #2a2a2a; } }
.subm-head { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.subm-msg { margin: 0.35rem 0; white-space: pre-wrap; }
.subm-actions { display: flex; gap: 0.4rem; }
button.subm-status { font: inherit; padding: 0.25rem 0.7rem; border: 1px solid #888; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
button.subm-status:disabled { opacity: 0.6; cursor: default; }
.pill.subm-new { background: #e8f0fe; color: #1a56db; }
.pill.subm-read { background: #f0f0f0; color: #555; }
.pill.subm-archived { background: #eee; color: #888; }
.pill.subm-spam { background: #fdecea; color: #b00; }
`;

/**
 * Render the per-site dashboard as a single HTML document. Pure function:
 * no Airtable access, no env reads, no I/O. The Netlify function handler
 * fetches data, then hands it here. Easier to unit-test, easier to render
 * a static preview from CLI later.
 */
export function renderSiteDashboardHtml(
  site: WebsiteRow,
  reports: ReportRow[],
  submissions: SubmissionRow[] = [],
): string {
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

  // The report-history TABLE is the only place the "recent 6" slice belongs:
  // long enough to show a quarter of monthly reports plus the latest testing
  // report, short enough to keep the page a single scroll. The pending list +
  // approve buttons above intentionally see the FULL `reports` set — an OLD
  // pending report that falls outside this slice must still be approvable
  // (and must not disagree with the fleet banner, which counts ALL reports).
  const recentReports = [...reports]
    .sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? ""))
    .slice(0, 6);
  const reportsSection =
    recentReports.length === 0
      ? `<div class="empty">No reports yet.</div>`
      : `<table>
          <thead><tr><th>Completed</th><th>Type</th><th>ID</th><th>Report</th><th></th></tr></thead>
          <tbody>${recentReports.map(reportRow).join("")}</tbody>
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
  ${pendingSection(reports)}
  ${submissionsSection(submissions)}

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
  <script>
    document.querySelectorAll("button.approve").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(b.dataset.approveUrl, { method: "POST" });
          b.textContent = res.ok ? "Approved" : "Failed";
          if (!res.ok) b.disabled = false;
        } catch {
          // Network rejection (offline, DNS, abort): mirror the !res.ok path so
          // the button doesn't sit permanently disabled reading "Approve".
          b.textContent = "Failed";
          b.disabled = false;
        }
      });
    });
    document.querySelectorAll("button.subm-status").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const res = await fetch(b.dataset.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: b.dataset.status }),
          });
          b.textContent = res.ok ? "✓" : "Failed";
          if (!res.ok) b.disabled = false;
        } catch {
          b.textContent = "Failed";
          b.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`;
}
