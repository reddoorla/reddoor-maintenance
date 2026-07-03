import type { WebsiteRow, SecurityAdvisory } from "../reports/airtable/websites.js";
import { SEVERITY_RANK, siteSlug } from "../reports/airtable/websites.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import { isPendingApproval } from "../reports/airtable/reports.js";
import type { SubmissionRow } from "../reports/submission-row.js";
import type { ScreenOutTotals } from "../db/screenouts.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";
import { FAVICON_LINK } from "./favicon.js";
import { onboardingStatus, missingOnboarding } from "./onboarding.js";
import { checklistFor, isChecklistComplete } from "../reports/checklist.js";
import { approveBlockers, type PreflightFinding } from "../reports/preflight.js";
import {
  renderSubmissionRow,
  SUBMISSION_STYLES,
  SUBMISSION_STATUS_SCRIPT,
  isVisibleInStrip,
} from "./submission-view.js";
import { SITE_STATUS_OPTIONS, FREQ_OPTIONS } from "./site-details.js";

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

/** One advisory line: a severity pill, the vulnerable module, the advisory title, any CVEs,
 *  and a link to the advisory when present. All Airtable-sourced text is escaped. */
function advisoryRow(a: SecurityAdvisory): string {
  const sev = escapeHtml(a.severity);
  const module = escapeHtml(a.module);
  // Build-time-only ("development") deps have a lower live-exploit surface for a static site;
  // flag them so a dev-scoped critical reads differently than a runtime one. Fixed literal — safe.
  const scope = a.scope === "development" ? ` <span class="muted">(dev)</span>` : "";
  const title = a.title ? ` — ${escapeHtml(a.title)}` : "";
  const cves =
    a.cves.length > 0 ? ` <span class="muted">(${escapeHtml(a.cves.join(", "))})</span>` : "";
  const link = a.url
    ? ` <a href="${escapeHtml(safeUrl(a.url))}" rel="noopener noreferrer">advisory ▸</a>`
    : "";
  return `<li class="vuln-item">
    <span class="pill sev-${sev}">${sev}</span>
    <strong>${module}</strong>${scope}${title}${cves}${link}
  </li>`;
}

/** The per-site vulnerability list — which packages are vulnerable, severity-sorted, not just the
 *  totals tile. Omitted entirely when the site was never audited (`null`) or is clean (empty). */
function securitySection(site: WebsiteRow): string {
  const advisories = site.securityAdvisories;
  if (!advisories || advisories.length === 0) return "";
  const sorted = [...advisories].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  return `<div class="section vulns">
    <h2>Vulnerabilities (${sorted.length})</h2>
    <ul class="vuln-list">${sorted.map(advisoryRow).join("")}</ul>
  </div>`;
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
 *  report's checklist is incomplete OR the report has send blockers (the
 *  convenience gate — approve.ts + orchestrate.ts are the hard backstops).
 *  `data-send-blocked` keeps the client's checklist re-gate from re-enabling a
 *  button the server disabled for blocker reasons. */
function approveButton(r: ReportRow, blocked: boolean): string {
  const disabled = isChecklistComplete(r) && !blocked ? "" : " disabled";
  const blockedAttr = blocked ? ` data-send-blocked="1"` : "";
  return `<button class="approve" data-report-id="${escapeHtml(r.id)}" data-approve-url="${escapeHtml(`/api/reports/${encodeURIComponent(r.id)}/approve`)}"${blockedAttr}${disabled}>Approve</button>`;
}

/** The preflight chip for one pending report: red = send blockers (approve
 *  disabled), amber = wrong-inbox warns, green = clear. Reasons ride the title
 *  tooltip. Same approveBlockers() the approve endpoint gates on, computed from
 *  data the page already fetched — the chip can't drift from the gate. */
function preflightChip(findings: PreflightFinding[]): string {
  const fails = findings.filter((f) => f.level === "fail");
  const warns = findings.filter((f) => f.level === "warn");
  if (fails.length > 0) {
    const title = escapeHtml(fails.map((f) => `${f.check}: ${f.message}`).join("\n"));
    return `<span class="preflight preflight-fail" title="${title}">preflight ✗ ${fails.length}</span>`;
  }
  if (warns.length > 0) {
    const title = escapeHtml(warns.map((f) => `${f.check}: ${f.message}`).join("\n"));
    return `<span class="preflight preflight-warn" title="${title}">preflight ⚠ ${warns.length}</span>`;
  }
  return `<span class="preflight preflight-ok" title="recipients, header image and report scores all present">preflight ✓</span>`;
}

function pendingRow(r: ReportRow, site: WebsiteRow): string {
  const type = escapeHtml(r.reportType);
  const period = r.period ? escapeHtml(r.period) : "—";
  const findings = approveBlockers(site, r);
  const blocked = findings.some((f) => f.level === "fail");
  return `<li><div class="pending-head"><strong>${type}</strong> <span class="muted">${period}</span> ${preflightChip(findings)} ${approveButton(r, blocked)}</div>${checklistBlock(r)}</li>`;
}

function pendingSection(reports: ReportRow[], site: WebsiteRow): string {
  const pending = reports.filter(isPendingApproval);
  if (pending.length === 0) return "";
  return `<div class="section pending">
    <h2>Pending your yes (${pending.length})</h2>
    <ul class="pending-list">${pending.map((r) => pendingRow(r, site)).join("")}</ul>
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

function reportRow(r: ReportRow, site: WebsiteRow): string {
  const date = r.completedOn ? escapeHtml(r.completedOn) : DASH;
  const type = escapeHtml(r.reportType);
  const id = escapeHtml(r.reportId);
  const ga = gaUsersCell(r);
  const search = searchCell(r);
  const link = r.renderedHtmlAttachment
    ? `<a href="${escapeHtml(safeUrl(r.renderedHtmlAttachment.url))}">view</a>`
    : `<span class="muted">no attachment</span>`;
  // Same gate as the pending section: an approve action in the history table
  // must not be a side door around the send-blocker gate.
  const action = isPendingApproval(r)
    ? approveButton(
        r,
        approveBlockers(site, r).some((f) => f.level === "fail"),
      )
    : "";
  return `<tr><td>${date}</td><td>${type}</td><td><code>${id}</code></td><td>${ga}</td><td>${search}</td><td>${link}</td><td>${action}</td></tr>`;
}

const SUBMISSIONS_PER_SITE_CAP = 25;

function submissionsSection(submissions: SubmissionRow[], site: WebsiteRow): string {
  const visible = submissions.filter(isVisibleInStrip);
  if (visible.length === 0) return "";
  const recent = [...visible]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_PER_SITE_CAP);
  // The heading shows the true total; when we only list a slice, say so rather
  // than implying every one of the N is on the page.
  const note =
    visible.length > recent.length
      ? `<span class="muted"> — showing ${recent.length} of ${visible.length}</span>`
      : "";
  const viewAll = `<a class="subm-viewall" href="/submissions?site=${escapeHtml(siteSlug(site.name))}">View all for this site →</a>`;
  return `<div class="section submissions">
    <h2>Form submissions (${visible.length})${note} ${viewAll}</h2>
    <ul class="subm-list">${recent.map(renderSubmissionRow).join("")}</ul>
  </div>`;
}

const SPAM_WINDOW_DAYS = 30;

/** The per-site spam panel: caught (honeypot/too-fast) + marked-spam from the screen-out
 *  buckets, and delivered counted from the submissions loaded for this page within the
 *  window. Omitted when there's nothing to show. `delivered` undercounts only if the site
 *  exceeds the 200-row submissions fetch within the window (rare at fleet scale). */
function spamScreenSection(
  totals: ScreenOutTotals | null,
  submissions: SubmissionRow[],
  now: Date,
): string {
  const sinceMs = now.getTime() - SPAM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const delivered = submissions.filter(
    (s) => s.submittedAt !== null && Date.parse(s.submittedAt) >= sinceMs,
  ).length;
  const t = totals ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
  if (delivered === 0 && t.honeypot === 0 && t.tooFast === 0 && t.markedSpam === 0) return "";
  const row = (label: string, n: number) =>
    `<div class="spam-kv"><span class="k">${label}</span> ${escapeHtml(String(n))}</div>`;
  return `<div class="section spam-screen">
    <h2>Spam screen (30d)</h2>
    ${row("Caught — honeypot", t.honeypot)}
    ${row("Caught — too-fast", t.tooFast)}
    ${row("Delivered", delivered)}
    ${row("Marked spam", t.markedSpam)}
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

/** One read-only "Site details" row: a label and a value that degrades to "—". */
function detailRow(label: string, value: string | null | undefined): string {
  const display =
    typeof value === "string" && value.trim().length > 0 ? escapeHtml(value.trim()) : DASH;
  return `<div class="detail"><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`;
}

/** A per-field "saved" indicator the page script flips to ✓ / ✗ after a POST. */
function savedSpan(field: string): string {
  return `<span class="detail-saved" data-for="${field}"></span>`;
}

/** Editable `<select>` row for an enum field (Status / cadence). */
function selectRow(
  label: string,
  field: string,
  options: readonly string[],
  current: string | null,
  url: string,
): string {
  const inList = current !== null && options.includes(current);
  const opts = options
    .map(
      (o) =>
        `<option value="${escapeHtml(o)}"${o === current ? " selected" : ""}>${escapeHtml(o)}</option>`,
    )
    .join("");
  // When the stored value isn't one of the offered options (e.g. a null cadence,
  // or an Airtable-only "legacy" status), show a disabled placeholder selected
  // first so the operator must actively pick — never silently overwrites.
  const placeholder = inList ? "" : `<option value="" disabled selected hidden>— select —</option>`;
  return `<div class="detail"><dt><label for="detail-${field}">${escapeHtml(label)}</label></dt><dd><select id="detail-${field}" data-detail-field="${field}" data-details-url="${url}">${placeholder}${opts}</select>${savedSpan(field)}</dd></div>`;
}

/** Editable single-line `<input>` row for a text/email/repo field. */
function inputRow(label: string, field: string, value: string | null, url: string): string {
  return `<div class="detail"><dt><label for="detail-${field}">${escapeHtml(label)}</label></dt><dd><input type="text" id="detail-${field}" data-detail-field="${field}" data-details-url="${url}" value="${escapeHtml(value ?? "")}" />${savedSpan(field)}</dd></div>`;
}

/** Editable multi-line `<textarea>` row for the copy override fields. */
function textareaRow(label: string, field: string, value: string | null, url: string): string {
  return `<div class="detail wide"><dt><label for="detail-${field}">${escapeHtml(label)}</label></dt><dd><textarea id="detail-${field}" data-detail-field="${field}" data-details-url="${url}">${escapeHtml(value ?? "")}</textarea>${savedSpan(field)}</dd></div>`;
}

/** "Site details" section — inline-editable for the safe-text + operational fields
 *  (writes via the authed /api/sites/:slug/details endpoint). `Last commit` stays
 *  read-only (machine-derived). The Trigger Renovate button rides the heading. */
function siteDetailsSection(site: WebsiteRow): string {
  const url = `/api/sites/${escapeHtml(siteSlug(site.name))}/details`;
  const lastCommit = site.lastCommitAt ? `${relativeTimeFromNow(site.lastCommitAt)}` : null;
  const rows = [
    selectRow("Status", "status", SITE_STATUS_OPTIONS, site.status, url),
    selectRow("Maintenance cadence", "maintenanceFreq", FREQ_OPTIONS, site.maintenanceFreq, url),
    selectRow("Testing cadence", "testingFreq", FREQ_OPTIONS, site.testingFreq, url),
    inputRow("Report recipients (To)", "reportRecipientsTo", site.reportRecipientsTo, url),
    inputRow("Report recipients (CC)", "reportRecipientsCc", site.reportRecipientsCc, url),
    inputRow("Point of contact", "pointOfContact", site.pointOfContact, url),
    inputRow("GA4 property", "ga4PropertyId", site.ga4PropertyId, url),
    inputRow("Search query", "searchQuery", site.searchQuery, url),
    inputRow("Git repo", "gitRepo", site.gitRepo, url),
    textareaRow("Copy — Intro", "copyIntro", site.copyIntro, url),
    textareaRow("Copy — Contact", "copyContact", site.copyContact, url),
    textareaRow("Copy — Footer", "copyFooter", site.copyFooter, url),
    detailRow("Last commit", lastCommit),
  ].join("");
  const triggerBtn = site.gitRepo?.trim()
    ? `<button class="trigger-renovate" data-trigger-url="/api/sites/${escapeHtml(siteSlug(site.name))}/trigger-renovate">Trigger Renovate</button>`
    : "";
  return `<div class="section site-details">
    <h2>Site details ${triggerBtn}</h2>
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
.preflight { font-size: 0.78rem; padding: 0.1rem 0.45rem; border-radius: 999px; white-space: nowrap; }
.preflight-ok { background: #1b5e2033; color: #7bc67e; }
.preflight-warn { background: #f9a82533; color: #d79921; }
.preflight-fail { background: #b71c1c33; color: #e57373; }
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
.vuln-list { list-style: none; padding: 0; margin: 0; }
.vuln-item { padding: 0.45rem 0; border-bottom: 1px solid #eee; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
@media (prefers-color-scheme: dark) { .vuln-item { border-color: #2a2a2a; } }
.pill.sev-critical { background: #fdecea; color: #b00; }
.pill.sev-high { background: #fff0e6; color: #c4500a; }
.pill.sev-moderate { background: #fff8e1; color: #8a6d00; }
.pill.sev-low { background: #f0f0f0; color: #555; }
.home { display: inline-block; font-size: 0.9rem; margin-bottom: 0.75rem; text-decoration: none; }
.setup-line { font-size: 0.9rem; color: #666; margin-bottom: 1rem; }
.setup-ok { color: #1b7a2f; font-weight: 600; }
.setup-missing { color: #a65a00; }
.details { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.5rem 1.5rem; margin: 0; }
.detail { display: flex; flex-direction: column; }
.detail.wide { grid-column: 1 / -1; }
.detail dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
.detail dd { margin: 0; }
.detail dd input, .detail dd select, .detail dd textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.25rem 0.4rem; border: 1px solid #ccc; border-radius: 4px; background: transparent; color: inherit; }
.detail dd textarea { min-height: 3.5rem; resize: vertical; }
.detail-saved { font-size: 0.8rem; color: #2a8; }
button.trigger-renovate { font: inherit; font-size: 0.8rem; padding: 0.15rem 0.6rem; margin-left: 0.5rem; border: 1px solid #888; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
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
  spamTotals: ScreenOutTotals | null = null,
  now: Date = new Date(),
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
          <tbody>${recentReports.map((r) => reportRow(r, site)).join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>${name} — Reddoor maintenance</title>
  <style>${STYLES}${SUBMISSION_STYLES}</style>
</head>
<body>
  <a class="home" href="/">← Fleet home</a>
  <h1>${name}</h1>
  <div class="meta"><a href="${escapeHtml(urlSafe)}">${escapeHtml(site.url)}</a></div>
  ${auditedLine}
  ${setupSection(site)}
  ${pendingSection(reports, site)}

  <div class="section">
    <h2>Lighthouse</h2>
    ${scoresSection}
  </div>

  <div class="section">
    <h2>Site Health</h2>
    ${healthSection}
  </div>

  ${securitySection(site)}

  <div class="section">
    <h2>Reports</h2>
    ${reportsSection}
  </div>

  ${siteDetailsSection(site)}
  ${spamScreenSection(spamTotals, submissions, now)}
  ${submissionsSection(submissions, site)}
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
    // Trigger-renovate button: async on-demand dispatch (mirrors the cockpit).
    document.querySelectorAll("button.trigger-renovate").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = "Dispatching…";
        try {
          const res = await fetch(b.dataset.triggerUrl, { method: "POST" });
          b.textContent = res.ok ? "Dispatched ✓" : "Failed";
          if (!res.ok) b.disabled = false;
        } catch {
          b.textContent = "Failed";
          b.disabled = false;
        }
      });
    });
    // Site-details editor: save on change (selects) / blur (inputs+textareas, only
    // when the value actually changed). The per-field span shows ✓ / ✗.
    function saveDetail(el) {
      const span = document.querySelector('.detail-saved[data-for="' + el.dataset.detailField + '"]');
      fetch(el.dataset.detailsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: el.dataset.detailField, value: el.value }),
      })
        .then((r) => {
          if (span) span.textContent = r.ok ? " ✓" : " ✗";
        })
        .catch(() => {
          if (span) span.textContent = " ✗";
        });
    }
    document.querySelectorAll("select[data-detail-field]").forEach((s) => {
      s.addEventListener("change", () => saveDetail(s));
    });
    document.querySelectorAll("input[data-detail-field], textarea[data-detail-field]").forEach((i) => {
      i.addEventListener("blur", () => {
        if (i.value !== i.defaultValue) saveDetail(i);
      });
    });
    ${SUBMISSION_STATUS_SCRIPT}
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
          if (approveBtn) approveBtn.disabled = !data.complete || approveBtn.dataset.sendBlocked === "1";
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
