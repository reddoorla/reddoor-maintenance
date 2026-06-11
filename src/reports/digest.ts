// src/reports/digest.ts
import type { ReportType } from "./types.js";
import { openBase, readAirtableConfig, type AirtableBase } from "./airtable/client.js";
import { listAllReports } from "./airtable/reports.js";
import type { ReportRow } from "./airtable/reports.js";
import { listWebsites, siteSlug } from "./airtable/websites.js";
import { defaultResendClient, type ResendClient } from "./send/resend.js";

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

/** Severity of a "Needs attention" entry. `critical` sorts above `warning`. */
export type AttentionSeverity = "critical" | "warning";

/** Set by `diffAttention` before render: how this item changed since the prior digest. */
export type AttentionStatus = "new" | "worse" | "standing";

/**
 * One "Needs attention" entry. The M5 SEAM, now carrying the fields the hybrid
 * snapshot needs: a stable `key` for diffing, a `metric` for NEW/WORSE comparison,
 * a `severity` for ordering, and `siteName` for the (component-3) grouped render.
 * For now `attentionSection` still renders each item flat by `title`/`url`.
 */
export type AttentionItem = {
  /** Stable identity for diffing: `vuln:<siteId>`, `delivery:<reportId>`. */
  key: string;
  kind: "vuln" | "delivery" | "renovate" | "lighthouse";
  /** Grouping key in the (component-3) render. */
  siteName: string;
  title: string;
  /** Optional URL rendered as a hyperlink on the title. */
  url?: string;
  severity: AttentionSeverity;
  /** Comparable magnitude for NEW/WORSE (vuln count; 1 for binary events). */
  metric: number;
  /** Set by `diffAttention` before render. */
  status?: AttentionStatus;
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

/** Shared anchor style — Gmail does not inherit font-family into <a> tags. */
const ANCHOR_STYLE = `color:${RED};font-family:helvetica,sans-serif`;

function readySection(items: ReadyItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Ready for your yes</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">Nothing waiting on you.</p>`;
  }
  const rows = items
    .map((it) => {
      const safeUrl = it.dashboardUrl.startsWith("https://") ? it.dashboardUrl : undefined;
      const link = safeUrl
        ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">review &amp; approve</a>`
        : `review &amp; approve`;
      return `
      <tr>
        <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">
          <strong style="color:#222">${esc(it.siteName)}</strong> — ${esc(it.reportType)} (${esc(it.period)})
          — ${link}
        </td>
      </tr>`;
    })
    .join("");
  return `${heading}<table role="presentation" style="border-collapse:collapse;margin:0">${rows}</table>`;
}

function attentionSection(items: AttentionItem[]): string {
  const heading = `<h2 style="color:${RED};font-family:helvetica,sans-serif;font-size:20px;font-weight:700;margin:32px 0 8px">Needs attention</h2>`;
  if (items.length === 0) {
    return `${heading}<p style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;margin:0">All clear — nothing needs attention.</p>`;
  }
  const rows = items
    .map((it) => {
      const safeUrl = it.url?.startsWith("https://") ? it.url : undefined;
      const label = safeUrl
        ? `<a href="${esc(safeUrl)}" style="${ANCHOR_STYLE}">${esc(it.title)}</a>`
        : esc(it.title);
      return `
      <tr>
        <td style="color:${GREY};font-family:helvetica,sans-serif;font-size:16px;line-height:24px;padding-bottom:8px">${label}</td>
      </tr>`;
    })
    .join("");
  return `${heading}<table role="presentation" style="border-collapse:collapse;margin:0">${rows}</table>`;
}

const FROM_ADDRESS = "Reddoor Reports <reports@reddoorla.com>";
/** Single-operator fleet — fallback when OPERATOR_EMAIL is unset. */
const DIGEST_OPERATOR_FALLBACK = "info@reddoorla.com";

/** UTC "YYYY-MM-DD" — the Resend idempotency key suffix, so a same-day cron re-fire dedupes. */
function digestDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The gate for "Ready for your yes": Draft ready ∧ ¬Approved to send ∧ Sent at BLANK.
 *
 * Implemented as `listAllReports(base).filter(...)` (the authorized deviation from the plan's
 * draft, which pre-dated Slice 1's merged fix): `listAllReports` already calls `mapRow`, which
 * handles `Period` correctly, so no local `rawToReportRow` duplicate is needed. The JS filter
 * does real work — the test fake does NOT evaluate `filterByFormula` — so correctness is
 * test-provable here.
 *
 * Exported: the fleet homepage (Task 3.5b) reuses it for the pending-approval count.
 */
export async function listPendingApproval(base: AirtableBase): Promise<ReportRow[]> {
  return (await listAllReports(base)).filter(
    (r) => r.draftReady && !r.approvedToSend && r.sentAt === null,
  );
}

export type DigestRunOptions = {
  resend?: ResendClient;
  /** Dashboard origin for the /s/<slug> links, e.g. "https://reddoor-maintenance.netlify.app". */
  baseUrl: string;
  /**
   * Inject a pre-opened Airtable base (tests, server handlers).
   * When omitted, `openBase(readAirtableConfig())` is called from the environment.
   */
  base?: AirtableBase;
};

export async function runDigest(
  options: DigestRunOptions,
): Promise<{ output: string; code: number }> {
  // Capture clock BEFORE any await so the idempotency key can't roll past midnight mid-run.
  const today = new Date();
  try {
    const base = options.base ?? openBase(readAirtableConfig());
    const websites = await listWebsites(base);
    const sites = new Map(websites.map((w) => [w.id, w]));

    const pending = await listPendingApproval(base);

    const readyForYourYes: ReadyItem[] = [];
    for (const r of pending) {
      const site = sites.get(r.siteId);
      if (!site) continue; // orphan report → skip rather than render a broken link
      readyForYourYes.push({
        siteName: site.name,
        reportType: r.reportType,
        period: r.period ?? "—",
        dashboardUrl: `${options.baseUrl.replace(/\/$/, "")}/s/${siteSlug(site.name)}`,
      });
    }

    // M5 fills this; M3 ships it empty (renders the "all clear" line).
    const needsAttention: AttentionItem[] = [];

    // No-noise default: skip entirely when there's nothing to report.
    if (readyForYourYes.length === 0 && needsAttention.length === 0) {
      return { output: "Digest skipped (nothing ready, nothing needs attention).", code: 0 };
    }

    const html = renderDigestHtml({ readyForYourYes, needsAttention });
    const client = options.resend ?? defaultResendClient();
    const to = [process.env.OPERATOR_EMAIL?.trim() || DIGEST_OPERATOR_FALLBACK];
    const n = readyForYourYes.length;
    const reportWord = n === 1 ? "report" : "reports";
    const result = await client.send({
      from: FROM_ADDRESS,
      to,
      subject: `Your fleet — ${digestDateKey(today)}: ${n} ${reportWord} ready for your yes`,
      html,
      idempotencyKey: `digest-${digestDateKey(today)}`,
    });
    return { output: `Digest sent to ${to.join(", ")} (${result.messageId})`, code: 0 };
  } catch (err) {
    // Re-throw config errors (exitCode=2: missing env vars, bad config) so runOrExit
    // surfaces them with the correct process exit code rather than collapsing to 1.
    if (typeof (err as { exitCode?: unknown }).exitCode === "number") {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return { output: `digest failed: ${message}`, code: 1 };
  }
}

/** Pure render of the unified daily operator digest. No IO — the caller (runDigest)
 *  collects the rows and decides whether to send. */
export function renderDigestHtml(sections: DigestSections): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#ffffff">
    <table width="100%" style="border-collapse:collapse">
      <tr>
        <td align="center" style="padding:24px">
          <table width="600" style="border-collapse:collapse">
            <tr>
              <td>
                <h1 style="color:${RED};font-family:helvetica,sans-serif;font-size:24px;font-weight:700;margin:0 0 8px">Your fleet today</h1>
                ${readySection(sections.readyForYourYes)}
                ${attentionSection(sections.needsAttention)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
