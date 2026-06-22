import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { isPendingApproval } from "../reports/airtable/reports.js";
import type { SubmissionRow } from "../reports/airtable/submissions.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";
import { FAVICON_LINK } from "./favicon.js";
import { onboardingStatus, missingOnboarding } from "./onboarding.js";
import { checklistFor, isChecklistComplete } from "../reports/checklist.js";

const DASH = "—";

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

/** The interactive operator-checklist for one pending report: one checkbox per
 *  `checklistFor(reportType)` item, current state from `report.checklist`, each
 *  carrying the report record id + the Airtable field name so the client can POST
 *  to /api/reports/:id/checklist and re-gate the Approve button. Launch/Announcement
 *  reports (empty checklist) render NOTHING — they are never gated. */
function checklistBlock(r: ReportRow): string {
  const items = checklistFor(r.reportType);
  if (items.length === 0) return "";
  const rid = escapeHtml(r.id);
  const url = `/api/reports/${encodeURIComponent(r.id)}/checklist`;
  const boxes = items
    .map((item) => {
      const checked = r.checklist[item.field] === true ? " checked" : "";
      const ev = r.autoEvidence?.[item.field];
      // Auto-tick provenance beside the box: green when the signal proved it (box also `checked`),
      // amber when a signal ran but isn't green (box left unticked, reason shown). No evidence →
      // a plain manual checkbox, exactly as before.
      const badge = ev
        ? ev.result === "pass"
          ? ` <span class="auto-badge auto-pass" title="${escapeHtml(ev.note)}">auto ✓</span>`
          : ` <span class="auto-badge auto-amber" title="${escapeHtml(ev.note)}">auto: ${escapeHtml(ev.note)}</span>`
        : "";
      return `<label class="check-item"><input type="checkbox" class="checklist-checkbox" data-checklist-report-id="${rid}" data-field="${escapeHtml(item.field)}" data-checklist-url="${escapeHtml(url)}"${checked} /> ${escapeHtml(item.label)}${badge}</label>`;
    })
    .join("");
  return `<div class="checklist" data-checklist-for="${rid}">${boxes}</div>`;
}

/** The Approve button for a pending report. Server-renders `disabled` when the
 *  report's checklist is incomplete (the convenience gate — approve.ts + orchestrate.ts
 *  are the hard backstops). Launch/Announcement have an empty checklist → never gated. */
function approveButton(r: ReportRow): string {
  const disabled = isChecklistComplete(r) ? "" : " disabled";
  return `<button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="/api/reports/${encodeURIComponent(r.id)}/approve"${disabled}>Approve</button>`;
}

function pendingRow(r: ReportRow): string {
  const type = escapeHtml(r.reportType);
  const period = r.period ? escapeHtml(r.period) : "—";
  return `<li><div class="pending-head"><strong>${type}</strong> <span class="muted">${period}</span> ${approveButton(r)}</div>${checklistBlock(r)}</li>`;
}

function pendingSection(reports: ReportRow[]): string {
  const pending = reports.filter(isPendingApproval);
  if (pending.length === 0) return "";
  return `<div class="section pending">
    <h2>Pending your yes (${pending.length})</h2>
    <ul class="pending-list">${pending.map(pendingRow).join("")}</ul>
  </div>`;
}

/** The GA "Users" cell for a report row: current count plus the signed delta vs
 *  the previous period when both are known. Renders "—" when there's no current
 *  count (GA not configured / fetch failed → blank in Airtable). */
function gaUsersCell(r: ReportRow): string {
  if (r.gaUsersCurrent === null) return DASH;
  const current = String(r.gaUsersCurrent);
  if (r.gaUsersPrevious === null) return escapeHtml(current);
  const delta = r.gaUsersCurrent - r.gaUsersPrevious;
  const sign = delta > 0 ? "+" : ""; // negatives carry their own "-"; zero shows "0"
  return `${escapeHtml(current)} <span class="muted">(${escapeHtml(`${sign}${delta}`)})</span>`;
}

/** The search-presence cell: the page-1 position when the site was found on
 *  page 1, otherwise "—" (not-found OR the check didn't run). */
function searchCell(r: ReportRow): string {
  if (r.searchFoundPage1 && r.searchPosition !== null) {
    return escapeHtml(`#${r.searchPosition}`);
  }
  return DASH;
}

function reportRow(r: ReportRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : DASH;
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const ga = gaUsersCell(r);
  const search = searchCell(r);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  const action = isPendingApproval(r) ? approveButton(r) : "";
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${ga}</td><td>${search}</td><td>${link}</td><td>${action}</td></tr>`;
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

const SUBMISSIONS_PER_SITE_CAP = 25;

function submissionsSection(submissions: SubmissionRow[]): string {
  if (submissions.length === 0) return "";
  const recent = [...submissions]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_PER_SITE_CAP);
  // The heading shows the true total; when we only list a slice, say so rather
  // than implying every one of the N is on the page.
  const note =
    submissions.length > recent.length
      ? `<span class="muted"> — showing ${recent.length} of ${submissions.length}</span>`
      : "";
  return `<div class="section submissions">
    <h2>Form submissions (${submissions.length})${note}</h2>
    <ul class="subm-list">${recent.map(submissionRow).join("")}</ul>
  </div>`;
}

/** Setup (N/4) status near the page header. Lists the missing onboarding items
 *  visibly (the cockpit chip only hovers them) so the operator sees what's left
 *  to wire up without leaving the page. */
function setupSection(site: WebsiteRow): string {
  const { score, total } = onboardingStatus(site);
  const missing = missingOnboarding(site);
  const detail =
    missing.length === 0
      ? `<span class="setup-ok">complete</span>`
      : `<span class="setup-missing">Missing: ${escapeHtml(missing.join(", "))}</span>`;
  return `<div class="setup-line">Setup ${score}/${total} — ${detail}</div>`;
}

/** One "Site details" definition-list row: a label and a value that degrades to
 *  "—" when the value is blank/null. */
function detailRow(label: string, value: string | null | undefined): string {
  const display =
    typeof value === "string" && value.trim().length > 0 ? escapeHtml(value.trim()) : DASH;
  return `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`;
}

/** "Site details" section: the WebsiteRow fields that feed reports/ops but aren't
 *  otherwise surfaced on the page — cadence, recipients, POC, and the optional GA /
 *  search / git wiring. Read-only; nulls render as "—". */
function siteDetailsSection(site: WebsiteRow): string {
  const lastCommit = site.lastCommitAt ? `${relativeTimeFromNow(site.lastCommitAt)}` : null;
  const rows = [
    detailRow("Maintenance cadence", site.maintenanceFreq),
    detailRow("Testing cadence", site.testingFreq),
    detailRow("Report recipients (To)", site.reportRecipientsTo),
    detailRow("Report recipients (CC)", site.reportRecipientsCc),
    detailRow("Point of contact", site.pointOfContact),
    detailRow("GA4 property", site.ga4PropertyId),
    detailRow("Search query", site.searchQuery),
    detailRow("Git repo", site.gitRepo),
    detailRow("Last commit", lastCommit),
  ].join("");
  return `<div class="section site-details">
    <h2>Site details</h2>
    <dl class="details">${rows}</dl>
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
.pending-list li { padding: 0.5rem; border-bottom: 1px solid #eee; }
@media (prefers-color-scheme: dark) { .pending-list li { border-color: #2a2a2a; } }
.pending-head { display: flex; align-items: center; gap: 0.5rem; }
.checklist { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; margin: 0.5rem 0 0.25rem 0.25rem; }
.check-item { display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; }
.check-item input { margin: 0; }
.auto-badge { font-size: 0.72rem; border-radius: 0.25rem; padding: 0 0.35rem; white-space: nowrap; }
.auto-pass { background: #e6f4ea; color: #137333; }
.auto-amber { background: #fef7e0; color: #b06000; }
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
.home { display: inline-block; font-size: 0.9rem; margin-bottom: 0.75rem; text-decoration: none; }
.setup-line { font-size: 0.9rem; color: #666; margin-bottom: 1rem; }
.setup-ok { color: #1b7a2f; font-weight: 600; }
.setup-missing { color: #a65a00; }
.details { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.5rem 1.5rem; margin: 0; }
.detail { display: flex; flex-direction: column; }
.detail dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
.detail dd { margin: 0; }
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
          <thead><tr><th>Completed</th><th>Type</th><th>ID</th><th>GA users</th><th>Search</th><th>Report</th><th></th></tr></thead>
          <tbody>${recentReports.map(reportRow).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>${name} — Reddoor maintenance</title>
  <style>${STYLES}</style>
</head>
<body>
  <a class="home" href="/">← Fleet home</a>
  <h1>${name}</h1>
  <div class="meta"><a href="${escapeHtml(urlSafe)}">${escapeHtml(site.url)}</a></div>
  ${auditedLine}
  ${setupSection(site)}
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

  ${siteDetailsSection(site)}
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
    // Checklist gate: ticking a box POSTs the one field; the response { complete }
    // decides whether THIS report's Approve button is enabled. Scoped per report by
    // matching the checkbox's report id to the Approve button's id, so multiple
    // pending reports on one page never cross-toggle. On failure the checkbox reverts.
    document.querySelectorAll("input.checklist-checkbox").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const reportId = cb.dataset.checklistReportId;
        const approveBtn = document.querySelector(
          'button.approve[data-report-id="' + (window.CSS && CSS.escape ? CSS.escape(reportId) : reportId) + '"]',
        );
        cb.disabled = true;
        try {
          const res = await fetch(cb.dataset.checklistUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reportId, field: cb.dataset.field, value: cb.checked }),
          });
          if (!res.ok) throw new Error("bad status");
          const data = await res.json();
          if (approveBtn) approveBtn.disabled = !data.complete;
        } catch {
          // Revert the optimistic flip so the box reflects the (unchanged) server state.
          cb.checked = !cb.checked;
        } finally {
          cb.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`;
}
