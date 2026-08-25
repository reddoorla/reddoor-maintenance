import { siteSlug } from "../airtable/websites.js";
import type { WebsiteRow } from "../airtable/websites.js";
import type { ReportRow } from "../airtable/reports.js";
import { resolveCopy } from "../copy.js";
import { announcementSiteExtras } from "../announcement-email/template.js";
import { renderReportEmail, type RenderedReportEmail } from "./render-email.js";
import type { ReportData } from "../types.js";
import { prepareHeaderImage } from "../maintenance-email/header-image.js";
import { applyReportTypeHeadline } from "../header-image/index.js";

/**
 * The scores a render cannot proceed without, or a message naming the exact
 * Airtable cause. Exported so `sendOne` can fail fast on it BEFORE the header
 * fetch and the sharp downscale, while the renderer stays independently safe for
 * a caller that did not — one message, one rule, two call sites.
 */
export function requireLighthouse(report: ReportRow): NonNullable<ReportRow["lighthouse"]> {
  if (!report.lighthouse) {
    throw new Error(
      `Report ${report.reportId} has no Lighthouse scores — all four cells ` +
        `(Lighthouse — Performance / Accessibility / Best Practices / SEO) must be numeric ` +
        `on the Reports row; one non-numeric or blank cell nulls all four`,
    );
  }
  return report.lighthouse;
}

/**
 * Assemble and render EXACTLY the email a send would produce, from a stored
 * report row plus the site's clean header plate.
 *
 * Lifted verbatim out of `sendOne`, which is the point: it is now the ONE path
 * from a row to rendered output, so the on-demand re-render behind the console's
 * report preview cannot drift from what the client actually receives. A preview
 * whose only job is fidelity is worthless if it renders through a second code
 * path that agrees with the sender by coincidence.
 *
 * Deliberately NOT included: recipient resolution, the health gate, and the
 * Resend call. Those are send concerns — a preview must be renderable for a
 * report that is not yet approvable, and must never be able to email anyone.
 *
 * `headerPlateBytes` is the CLEAN plate, not a finished header: this stamps the
 * report type's headline onto it and downscales the result, which is why the
 * caller can hand over Airtable's attachment bytes or Turso's stored BLOB
 * interchangeably.
 */
export async function renderReportFromRow(
  site: WebsiteRow,
  report: ReportRow,
  headerPlateBytes: Uint8Array,
): Promise<RenderedReportEmail> {
  // The stored header is the CLEAN plate; stamp this report type's headline
  // onto it (all four types are registered — see assets/index.ts HEADLINE_FILES),
  // then downscale the (often multi-MB / 2400px+) result to email display
  // size, getting back display dims + a placeholder color so the template can
  // reserve the box.
  const withHeadline = await applyReportTypeHeadline(headerPlateBytes, report.reportType);
  const header = await prepareHeaderImage(withHeadline);

  const slug = siteSlug(site.name);
  const cidName = `${slug}-header`;
  const gaPeriodDays =
    report.reportType === "Announcement" ? 30 : windowDays(report.periodStart, report.periodEnd);
  const reportData: ReportData = {
    siteName: site.name,
    siteUrl: site.url,
    reportType: report.reportType,
    completedOn: report.completedOn ? new Date(report.completedOn) : new Date(),
    lighthouse: requireLighthouse(report),
    gaUsersCurrent: report.gaUsersCurrent ?? undefined,
    gaUsersPrevious: report.gaUsersPrevious ?? undefined,
    gaPeriodDays,
    searchPosition:
      report.searchFoundPage1 && report.searchPosition !== null ? report.searchPosition : undefined,
    lastTestedDate: report.lastTestedDate ? new Date(report.lastTestedDate) : null,
    commentary: report.commentary,
    copy: resolveCopy(site),
    headerImageCid: cidName,
    headerWidth: header.displayWidth,
    headerHeight: header.displayHeight,
    headerBgColor: header.placeholderColor,
    // Announcement-only: re-derive cadence + improvements from the site row so the SENT email
    // keeps its cadence copy + improvement callouts (not stored on the Reports row).
    ...(report.reportType === "Announcement" ? announcementSiteExtras(site) : {}),
  };

  return renderReportEmail(reportData, {
    header,
    cidName,
    subjectOverride: report.subjectOverride ?? undefined,
  });
}

/** Whole days spanned by an ISO period window, or undefined when either bound is missing or the
 *  span isn't positive. Drives the analytics trend's "vs the previous N days" label. */
export function windowDays(start: string | null, end: string | null): number | undefined {
  if (!start || !end) return undefined;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
