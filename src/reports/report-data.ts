import type { WebsiteRow } from "./airtable/websites.js";
import { siteSlug } from "./airtable/websites.js";
import type { LighthouseScores, ReportData, ReportType } from "./types.js";
import { resolveCopy } from "./copy.js";
import { fetchGaUsers, fetchSearch } from "./draft.js";
import { announcementSiteExtras } from "./announcement-email/template.js";
import type { PreparedHeader } from "./send/render-email.js";

/** The traffic/search lookback window (days) used for report-email previews. */
const PREVIEW_WINDOW_DAYS = 30;

/** The four stored Lighthouse scores off a Websites row, or null if ANY is missing. */
export function scoresFromRow(site: WebsiteRow): LighthouseScores | null {
  if (
    site.pScore === null ||
    site.rScore === null ||
    site.bpScore === null ||
    site.seoScore === null
  ) {
    return null;
  }
  return {
    performance: site.pScore,
    accessibility: site.rScore,
    bestPractices: site.bpScore,
    seo: site.seoScore,
  };
}

/**
 * Assemble the `ReportData` for a report email from a Websites row, for a given report type. Used
 * by the `selftest` command to preview any report type without an Airtable Reports row. Reuses the
 * same enrichment helpers as the real drafts (`fetchGaUsers`/`fetchSearch`, `resolveCopy`,
 * `announcementSiteExtras`). The GA window is a fixed 30 days (a no-write preview can't read the
 * real recurrence anchor). `Launch` skips GA entirely — the launch email shows no analytics.
 */
export async function buildReportDataForSite(
  site: WebsiteRow,
  type: ReportType,
  now: Date,
  opts: { scores: LighthouseScores; header: PreparedHeader },
): Promise<ReportData> {
  const { scores, header } = opts;
  const cidName = `${siteSlug(site.name)}-header`;
  const base: ReportData = {
    siteName: site.name,
    siteUrl: site.url,
    reportType: type,
    completedOn: now,
    lighthouse: scores,
    lastTestedDate:
      type === "Maintenance" && site.lastLighthouseAuditAt
        ? new Date(site.lastLighthouseAuditAt)
        : null,
    commentary: null,
    copy: resolveCopy(site),
    headerImageCid: cidName,
    headerWidth: header.displayWidth,
    headerHeight: header.displayHeight,
    headerBgColor: header.placeholderColor,
  };

  // The launch email renders no analytics — don't even fetch GA/search.
  if (type === "Launch") return base;

  const periodStart = new Date(now.getTime() - PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const gaUsers = (await fetchGaUsers(site, periodStart, now)).value;
  const search = (await fetchSearch(site, periodStart, now)).value;

  const withAnalytics: ReportData = {
    ...base,
    ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
    gaPeriodDays: PREVIEW_WINDOW_DAYS,
    ...(search?.foundOnPage1 && search.position !== null
      ? { searchPosition: search.position }
      : {}),
  };

  if (type === "Announcement") {
    return { ...withAnalytics, ...announcementSiteExtras(site) };
  }
  return withAnalytics; // Maintenance / Testing
}
