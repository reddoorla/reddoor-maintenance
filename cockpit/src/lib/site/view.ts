import type { WebsiteRow, SecurityAdvisory } from "../../../../src/fleet/site-row.js";
import type { SetupGapView } from "../cockpit/view.js";
import { SEVERITY_RANK, siteSlug } from "../../../../src/fleet/site-row.js";
import type { ReportRow } from "../../../../src/reports/report-fields.js";
import { isPendingApproval } from "../../../../src/reports/report-fields.js";
import type { EvidenceResult } from "../../../../src/reports/auto-tick.js";
import type { SubmissionRow } from "../../../../src/reports/submission-row.js";
import type { ScreenOutTotals } from "../../../../src/db/screenouts.js";
import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
import { safeUrl } from "../../../../src/util/html.js";
import { onboardingStatus, missingOnboarding } from "../../../../src/dashboard/onboarding.js";
import {
  checklistFor,
  gatingFields,
  isHealthGateClear,
} from "../../../../src/reports/checklist.js";
import { rendersCommentary } from "../../../../src/reports/render.js";
import { approveBlockers, type PreflightFinding } from "../../../../src/reports/preflight.js";
import { parseAddresses, withGlobalCc } from "../../../../src/reports/send/orchestrate.js";
import { isVisibleInStrip } from "../../../../src/dashboard/submission-rules.js";
import {
  SITE_STATUS_OPTIONS,
  FREQ_OPTIONS,
  WATCH_CONDITION_OPTIONS,
  CLEAR_SECRET,
} from "../../../../src/dashboard/site-details.js";
import {
  withdrawConfirmText,
  UNAPPROVE_CONFIRM_TEXT,
} from "../../../../src/dashboard/report-confirm.js";
import { assignTier, type SiteAlarmContext } from "../../../../src/dashboard/fleet-cockpit.js";
import { buildSubmissionRowView, type SubmissionRowView } from "../submission/view.js";

/**
 * The `/s/:slug` page as plain data (#582). Every value the old string renderer
 * (src/dashboard/render.ts) derived is derived here, on the server, by the same
 * helpers: several of them (preflight, recipients, the commentary rule) live in
 * modules that reach the send path, which must never ship to the browser. The
 * components only lay this out and run the page's actions.
 */

const DASH = "—";

export type Tile = { label: string; display: string; sub: string | null };

export type ApproveView = {
  reportId: string;
  url: string;
  blocked: boolean;
  /** Server-rendered disabled: the health gate is not clear, or a send blocker fails. */
  disabled: boolean;
};

export type CommentaryView = { id: string; url: string; text: string };

export type PendingView = {
  id: string;
  type: string;
  period: string;
  preflight: { cls: string; title: string; text: string };
  previewHref: string | null;
  rerenderUrl: string | null;
  approve: ApproveView;
  withdraw: { url: string; confirm: string };
  recipients: { missing: true } | { missing: false; text: string };
  sendLine: string;
  checklist: {
    items: Array<{
      cls: string;
      word: string;
      title: string;
      label: string;
      advisory: boolean;
      note: string | null;
    }>;
  } | null;
  commentary: CommentaryView | null;
  overrideUrl: string | null;
};

export type HistoryAction =
  | { kind: "none" }
  | { kind: "withdrawn"; date: string }
  | { kind: "approve"; approve: ApproveView }
  | { kind: "approved"; rerenderUrl: string | null; unapprove: { url: string; confirm: string } }
  | { kind: "sending"; at: string };

export type HistoryRow = {
  id: string;
  date: string;
  type: string;
  reportId: string;
  ga: { current: string; delta: string | null } | null;
  search: string;
  previewHref: string | null;
  action: HistoryAction;
  /** Present when the row carries a commentary row beneath it; `editor` is null
   *  when the report type never renders commentary. */
  commentaryRow: { editor: CommentaryView | null } | null;
};

export type AdvisoryView = {
  severity: string;
  module: string;
  dev: boolean;
  title: string | null;
  cves: string | null;
  href: string | null;
};

export type Chip = { cls: string; title: string | null; text: string };

export type DetailRowView =
  | { kind: "select"; label: string; field: string; options: string[]; current: string | null }
  | { kind: "input"; label: string; field: string; value: string }
  | { kind: "date"; label: string; field: string; value: string }
  | { kind: "textarea"; label: string; field: string; value: string }
  | { kind: "checkbox"; label: string; field: string; checked: boolean }
  | { kind: "secret"; label: string; field: string; placeholder: string }
  | { kind: "multi"; label: string; field: string; options: string[]; selected: string[] }
  | { kind: "readonly"; label: string; display: string };

export type SiteView = {
  name: string;
  url: string;
  urlHref: string;
  audited: string | null;
  failingAudits: string | null;
  setup: { score: number; total: number; missing: string[] };
  /** Roster gaps (#672 step 2): the Setup checklist, apart from the alarm. */
  setupGaps: SetupGapView[];
  alarm: { label: string; chips: Chip[] } | null;
  pending: PendingView[];
  scores: Tile[] | null;
  health: Tile[] | null;
  advisories: AdvisoryView[];
  history: HistoryRow[];
  details: { url: string; triggerUrl: string | null; rows: DetailRowView[] };
  spam: Array<{ label: string; n: number }> | null;
  submissions: {
    total: number;
    shown: SubmissionRowView[];
    viewAllHref: string;
  } | null;
};

function reportPreviewUrl(reportId: string): string {
  return `/api/reports/${encodeURIComponent(reportId)}/preview`;
}

function approveView(r: ReportRow, blocked: boolean): ApproveView {
  const gateClear = isHealthGateClear({
    reportType: r.reportType,
    autoEvidence: r.autoEvidence ?? {},
  });
  return {
    reportId: r.id,
    url: `/api/reports/${encodeURIComponent(r.id)}/approve`,
    blocked,
    disabled: !(gateClear && !blocked),
  };
}

function rerenderUrl(r: ReportRow): string | null {
  return r.sentAt !== null ? null : `/api/reports/${encodeURIComponent(r.id)}/rerender`;
}

function commentaryView(r: ReportRow): CommentaryView | null {
  if (!rendersCommentary(r.reportType)) return null;
  return {
    id: r.id,
    url: `/api/reports/${encodeURIComponent(r.id)}/commentary`,
    text: r.commentary ?? "",
  };
}

function preflight(findings: PreflightFinding[]): PendingView["preflight"] {
  const fails = findings.filter((f) => f.level === "fail");
  const warns = findings.filter((f) => f.level === "warn");
  if (fails.length > 0) {
    return {
      cls: "preflight preflight-fail",
      title: fails.map((f) => `${f.check}: ${f.message}`).join("\n"),
      text: `preflight ✗ ${fails.length}`,
    };
  }
  if (warns.length > 0) {
    return {
      cls: "preflight preflight-warn",
      title: warns.map((f) => `${f.check}: ${f.message}`).join("\n"),
      text: `preflight ⚠ ${warns.length}`,
    };
  }
  return {
    cls: "preflight preflight-ok",
    title: "recipients, header image and report scores all present",
    text: "preflight ✓",
  };
}

/** The next 16:07 UTC send run strictly after `now`. */
function nextDailyRun(now: Date): Date {
  const run = new Date(now);
  run.setUTCHours(16, 7, 0, 0);
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/** The send-timing line: honest about today's run possibly being in flight,
 *  and a countdown that floors. Same as render.ts's `sendTimingLine`. */
function sendTimingLine(now: Date): string {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const RUN_START = 16 * 60 + 7;
  const GRACE_END = 17 * 60 + 15;
  if (minuteOfDay >= RUN_START && minuteOfDay < GRACE_END) {
    return "today's 16:07 UTC send may still be in flight — approving now can send within minutes";
  }
  const run = nextDailyRun(now);
  const leadMin = Math.floor((run.getTime() - now.getTime()) / 60_000);
  const lead =
    leadMin >= 60
      ? `~${Math.floor(leadMin / 60)}h`
      : leadMin >= 1
        ? `~${leadMin} min`
        : "under 1 min";
  return `approve ≠ send: goes out at the next send, 16:07 UTC (${lead})`;
}

function recipients(site: WebsiteRow): PendingView["recipients"] {
  const to = parseAddresses(site.reportRecipientsTo) ?? parseAddresses(site.pointOfContact) ?? [];
  if (to.length === 0) return { missing: true };
  const cc = withGlobalCc(parseAddresses(site.reportRecipientsCc), to);
  const ccPart = cc.length > 0 ? ` · CC ${cc.join(", ")}` : "";
  return { missing: false, text: `To ${to.join(", ")}${ccPart}` };
}

function healthPresentation(status: EvidenceResult): { cls: string; word: string } {
  switch (status) {
    case "pass":
      return { cls: "healthy", word: "clear" };
    case "fail":
      return { cls: "attention", word: "blocks" };
    case "n/a":
      return { cls: "na", word: "n/a" };
    default:
      return { cls: "watch", word: "needs you" };
  }
}

function checklist(r: ReportRow): PendingView["checklist"] {
  const items = checklistFor(r.reportType);
  if (items.length === 0) return null;
  const gating = new Set(gatingFields(r.reportType));
  return {
    items: items.map((item) => {
      const ev = r.autoEvidence?.[item.field];
      const { cls, word } = healthPresentation(ev?.result ?? "unknown");
      return {
        cls,
        word,
        title: ev?.note ?? "not yet measured",
        label: item.label,
        advisory: !gating.has(item.field),
        note: ev?.note ? ev.note : null,
      };
    }),
  };
}

function pendingView(r: ReportRow, site: WebsiteRow, now: Date): PendingView {
  const findings = approveBlockers(site, r);
  const blocked = findings.some((f) => f.level === "fail");
  const gateClear = isHealthGateClear({
    reportType: r.reportType,
    autoEvidence: r.autoEvidence ?? {},
  });
  return {
    id: r.id,
    type: r.reportType,
    period: r.period ? r.period : DASH,
    preflight: preflight(findings),
    previewHref: r.renderedHtmlAttachment ? reportPreviewUrl(r.id) : null,
    rerenderUrl: rerenderUrl(r),
    approve: approveView(r, blocked),
    withdraw: {
      url: `/api/reports/${encodeURIComponent(r.id)}/withdraw`,
      confirm: withdrawConfirmText(r),
    },
    recipients: recipients(site),
    sendLine: sendTimingLine(now),
    checklist: checklist(r),
    commentary: commentaryView(r),
    overrideUrl: gateClear ? null : `/api/reports/${encodeURIComponent(r.id)}/approve?override=1`,
  };
}

function historyRow(r: ReportRow, site: WebsiteRow): HistoryRow {
  let ga: HistoryRow["ga"] = null;
  if (r.gaUsersCurrent !== null) {
    if (r.gaUsersPrevious === null) ga = { current: String(r.gaUsersCurrent), delta: null };
    else {
      const delta = r.gaUsersCurrent - r.gaUsersPrevious;
      ga = { current: String(r.gaUsersCurrent), delta: `${delta > 0 ? "+" : ""}${delta}` };
    }
  }
  // Same gate as the pending section: an approve action in the history table
  // must not be a side door around the send-blocker gate.
  const action: HistoryAction =
    r.sentAt === null && r.withdrawnAt !== null
      ? { kind: "withdrawn", date: (r.withdrawnAt ?? "").slice(0, 10) }
      : isPendingApproval(r)
        ? {
            kind: "approve",
            approve: approveView(
              r,
              approveBlockers(site, r).some((f) => f.level === "fail"),
            ),
          }
        : r.sentAt === null && r.approvedToSend
          ? r.sendStartedAt === null
            ? {
                kind: "approved",
                rerenderUrl: rerenderUrl(r),
                unapprove: {
                  url: `/api/reports/${encodeURIComponent(r.id)}/unapprove`,
                  confirm: UNAPPROVE_CONFIRM_TEXT,
                },
              }
            : {
                kind: "sending",
                at: (r.sendStartedAt ?? "").slice(0, 16).replace("T", " "),
              }
          : { kind: "none" };
  return {
    id: r.id,
    date: r.completedOn ? r.completedOn : DASH,
    type: r.reportType,
    reportId: r.reportId,
    ga,
    search: r.searchFoundPage1 && r.searchPosition !== null ? `#${r.searchPosition}` : DASH,
    previewHref: r.renderedHtmlAttachment ? reportPreviewUrl(r.id) : null,
    action,
    // Commentary stays editable for the WHOLE unsent window; a pending report
    // already carries its editor in the pending list.
    commentaryRow:
      r.sentAt === null && r.withdrawnAt === null && !isPendingApproval(r)
        ? { editor: commentaryView(r) }
        : null,
  };
}

function advisory(a: SecurityAdvisory): AdvisoryView {
  return {
    severity: a.severity,
    module: a.module,
    dev: a.scope === "development",
    title: a.title ? a.title : null,
    cves: a.cves.length > 0 ? a.cves.join(", ") : null,
    href: a.url ? safeUrl(a.url) : null,
  };
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

function alarm(a: SiteAlarmContext | null): SiteView["alarm"] {
  if (!a) return null;
  const chips: Chip[] = [];
  for (const it of a.items) {
    if (it.waiting === true) {
      chips.push({
        cls: "chip waiting",
        title: "A scheduled job is still fixing this; it reaches the cockpit only if that fails",
        text: `waiting: ${it.title}`,
      });
      continue;
    }
    const cls = it.autoFixExhausted
      ? "chip critical stuck"
      : it.severity === "critical"
        ? "chip critical"
        : "chip";
    chips.push({ cls, title: null, text: it.title });
  }
  a.watchReasons.forEach((reason, i) => {
    const key = a.watchAcceptKeys[i];
    chips.push({
      cls: "chip",
      title: "Add this exact text to the site's Accepted Watch Conditions to mute this watch",
      text: `${reason}${key ? ` · accept: "${key}"` : ""}`,
    });
  });
  for (const reason of a.acceptedReasons)
    chips.push({ cls: "chip accepted", title: null, text: `✓ accepted: ${reason}` });
  if (chips.length === 0) return null;
  const label =
    a.tier === "attention" ? "Needs attention" : a.tier === "watch" ? "Watch" : "Status";
  return { label, chips };
}

function detailRows(site: WebsiteRow): DetailRowView[] {
  const select = (
    label: string,
    field: string,
    options: readonly string[],
    current: string | null,
  ): DetailRowView => ({ kind: "select", label, field, options: [...options], current });
  const input = (label: string, field: string, value: string | null): DetailRowView => ({
    kind: "input",
    label,
    field,
    value: value ?? "",
  });
  const textarea = (label: string, field: string, value: string | null): DetailRowView => ({
    kind: "textarea",
    label,
    field,
    value: value ?? "",
  });
  // `<input type="date">` accepts ONLY YYYY-MM-DD; anything longer would be
  // sanitized to "" by the browser and read as an edit (render.ts's toDateInputValue).
  const date = (label: string, field: string, value: string | null): DetailRowView => ({
    kind: "date",
    label,
    field,
    value: (value ?? "").slice(0, 10),
  });
  const lastCommit = site.lastCommitAt ? `${relativeTimeFromNow(site.lastCommitAt)}` : null;
  return [
    // `statusRaw`, not `status`: the options ARE the stored cell values.
    select("Status", "status", SITE_STATUS_OPTIONS, site.statusRaw),
    select("Maintenance cadence", "maintenanceFreq", FREQ_OPTIONS, site.maintenanceFreq),
    select("Testing cadence", "testingFreq", FREQ_OPTIONS, site.testingFreq),
    input("Site URL", "url", site.url),
    input("Report recipients (To)", "reportRecipientsTo", site.reportRecipientsTo),
    input("Report recipients (CC)", "reportRecipientsCc", site.reportRecipientsCc),
    input("Point of contact", "pointOfContact", site.pointOfContact),
    input("GA4 property", "ga4PropertyId", site.ga4PropertyId),
    input("Search query", "searchQuery", site.searchQuery),
    input("Git repo", "gitRepo", site.gitRepo),
    input("Netlify ID", "netlifyId", site.netlifyId),
    input("Search Console property", "searchConsoleProperty", site.searchConsoleProperty),
    input("Newsletter webhook", "newsletterWebhook", site.newsletterWebhook),
    input("Mailchimp audience ID", "mailchimpAudienceId", site.mailchimpAudienceId),
    date("Last maintenance day", "maintenanceDay", site.maintenanceDay),
    date("Last testing day", "testingDay", site.testingDay),
    textarea("Notify routing (JSON)", "notifyRouting", site.notifyRoutingRaw),
    {
      kind: "checkbox",
      label: "Require Turnstile",
      field: "requireTurnstile",
      checked: site.requireTurnstile,
    },
    {
      kind: "secret",
      label: "Mailchimp API key",
      field: "mailchimpApiKey",
      // The stored key never reaches the page; the placeholder says only whether
      // one is set, and names the clear sentinel verbatim.
      placeholder:
        site.mailchimpApiKey !== null
          ? `•••••••• (type to replace, or ${CLEAR_SECRET} to erase)`
          : "not set",
    },
    {
      kind: "multi",
      label: "Accepted watch conditions",
      field: "acceptedWatchConditions",
      options: [...WATCH_CONDITION_OPTIONS],
      selected: [...site.acceptedWatchConditions],
    },
    textarea("Copy — Intro", "copyIntro", site.copyIntro),
    textarea("Copy — Contact", "copyContact", site.copyContact),
    textarea("Copy — Footer", "copyFooter", site.copyFooter),
    {
      kind: "readonly",
      label: "Last commit",
      display:
        typeof lastCommit === "string" && lastCommit.trim().length > 0 ? lastCommit.trim() : DASH,
    },
  ];
}

const SUBMISSIONS_PER_SITE_CAP = 25;
const SPAM_WINDOW_DAYS = 30;

function spam(
  totals: ScreenOutTotals | null,
  submissions: SubmissionRow[],
  now: Date,
): SiteView["spam"] {
  const sinceMs = now.getTime() - SPAM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = submissions.filter(
    (s) => s.submittedAt !== null && Date.parse(s.submittedAt) >= sinceMs,
  );
  const delivered = inWindow.filter((s) => s.status !== "spam_auto" && s.status !== "spam").length;
  const autoFiltered = inWindow.filter((s) => s.status === "spam_auto").length;
  const t = totals ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
  if (
    delivered === 0 &&
    autoFiltered === 0 &&
    t.honeypot === 0 &&
    t.tooFast === 0 &&
    t.markedSpam === 0
  )
    return null;
  return [
    { label: "Caught — honeypot", n: t.honeypot },
    { label: "Caught — too-fast", n: t.tooFast },
    { label: "Auto-filtered", n: autoFiltered },
    { label: "Delivered", n: delivered },
    { label: "Marked spam", n: t.markedSpam },
  ];
}

export function buildSiteView(
  site: WebsiteRow,
  reports: ReportRow[],
  submissions: SubmissionRow[],
  spamTotals: ScreenOutTotals | null,
  now: Date,
  siteAlarm: SiteAlarmContext | null,
): SiteView {
  const allScoresNull =
    site.pScore === null && site.rScore === null && site.bpScore === null && site.seoScore === null;
  const show = (v: number | null) => (v === null ? DASH : String(v));
  const secTotal = securityTotal(site);
  const allHealthNull =
    site.a11yViolations === null && site.depsDrifted === null && secTotal === null;
  const { a11yRoutesScanned: scanned, a11yRoutesTotal: total } = site;
  const a11ySub =
    scanned === null || total === null
      ? null
      : scanned < total
        ? `only ${scanned} of ${total} routes scanned`
        : `${scanned} of ${total} routes scanned`;
  const depsSub =
    site.depsMajorBehind === null || site.depsMajorBehind === 0
      ? null
      : `${site.depsMajorBehind} major behind`;
  const securitySub =
    secTotal === null || secTotal === 0
      ? null
      : `${site.securityVulnsCritical ?? 0}C / ${site.securityVulnsHigh ?? 0}H / ${site.securityVulnsModerate ?? 0}M / ${site.securityVulnsLow ?? 0}L`;

  const { score, total: setupTotal } = onboardingStatus(site, now);
  const slug = siteSlug(site.name);

  // The report-history table is the only place the "recent 6" slice belongs;
  // the pending list sees the FULL set, so an old pending report stays approvable.
  const recent = [...reports]
    .sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? ""))
    .slice(0, 6);

  const visible = submissions.filter(isVisibleInStrip);
  const shown = [...visible]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_PER_SITE_CAP);

  return {
    name: site.name,
    url: site.url,
    urlHref: safeUrl(site.url),
    audited: site.lastLighthouseAuditAt ? relativeTimeFromNow(site.lastLighthouseAuditAt) : null,
    failingAudits: site.lighthouseFailingAudits ? site.lighthouseFailingAudits : null,
    setup: { score, total: setupTotal, missing: missingOnboarding(site, now) },
    // The gaps come from the row alone, so they survive an alarm read that
    // failed (siteAlarm null); otherwise the score would say "complete" over a
    // gap the page simply could not show (review round 2).
    setupGaps: (siteAlarm?.setup ?? assignTier(site, [], now).setup).map((g) => ({
      reason: g.reason,
      acceptKey: g.acceptKey,
    })),
    alarm: alarm(siteAlarm),
    pending: reports.filter(isPendingApproval).map((r) => pendingView(r, site, now)),
    scores: allScoresNull
      ? null
      : [
          { label: "Performance", display: show(site.pScore), sub: null },
          { label: "Accessibility", display: show(site.rScore), sub: null },
          { label: "Best Practices", display: show(site.bpScore), sub: null },
          { label: "SEO", display: show(site.seoScore), sub: null },
        ],
    health: allHealthNull
      ? null
      : [
          { label: "Accessibility issues", display: show(site.a11yViolations), sub: a11ySub },
          { label: "Dependency updates", display: show(site.depsDrifted), sub: depsSub },
          { label: "Security alerts", display: show(secTotal), sub: securitySub },
        ],
    advisories: [...(site.securityAdvisories ?? [])]
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .map(advisory),
    history: recent.map((r) => historyRow(r, site)),
    details: {
      url: `/api/sites/${slug}/details`,
      triggerUrl: site.gitRepo?.trim() ? `/api/sites/${slug}/trigger-renovate` : null,
      rows: detailRows(site),
    },
    spam: spam(spamTotals, submissions, now),
    submissions:
      visible.length === 0
        ? null
        : {
            total: visible.length,
            shown: shown.map(buildSubmissionRowView),
            viewAllHref: `/submissions?site=${slug}`,
          },
  };
}
