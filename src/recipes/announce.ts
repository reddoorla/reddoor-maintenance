import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import {
  createDraft,
  findReportByPeriod,
  updateReportScores,
  type ReportEnrichment,
} from "../reports/airtable/reports.js";
import { queueDraft } from "../reports/queue.js";
import { uploadAttachment } from "../reports/airtable/attachments.js";
import { renderReportHtml } from "../reports/render.js";
import { resolveCopy } from "../reports/copy.js";
import { fetchGaUsers, fetchSearch } from "../reports/draft.js";
import { announcementSiteExtras } from "../reports/announcement-email/template.js";
import type { LighthouseScores } from "../reports/types.js";
import { defaultReportSubject } from "../reports/subject.js";

export type AnnounceSiteResult =
  | {
      site: string;
      status: "drafted" | "reused";
      reportId: string;
      recipientMissing: boolean;
      /** False when a higher-or-equal-tier report was already queued (single-queue rule). */
      queued: boolean;
    }
  | { site: string; status: "skipped-no-scores" }
  | { site: string; status: "error"; message: string };

export type AnnounceResult = { results: AnnounceSiteResult[] };

/** The traffic/search lookback window (days) the announcement reports on. The trend compares it
 *  against the equal-length prior window, and the email labels it "vs the previous N days". */
const GA_WINDOW_DAYS = 30;

export type AnnounceDeps = {
  /** Airtable handle. Defaults to opening the live base from credentials. */
  base?: AirtableBase;
  /** When set, restrict to the single site whose slug matches. Default: all maintenance sites. */
  site?: string;
  /** Single timestamp driving the period key, render, draft, and preview filename. */
  now?: Date;
};

/**
 * Draft the monthly-report ANNOUNCEMENT email for every `maintenance` site (or one,
 * via `deps.site`). Airtable-driven and fleet-wide: unlike `launch`, it runs no audits
 * and takes no `Site`/inventory object — it reads the Lighthouse scores already stored
 * on each Websites row. DRAFTS ONLY; the M3 approve loop sends.
 *
 * One bad site must never abort the run: each site is wrapped in its own try/catch that
 * records an `error` result and continues.
 */
export async function announce(deps?: AnnounceDeps): Promise<AnnounceResult> {
  const base = deps?.base ?? openBase(readAirtableConfig());
  const now = deps?.now ?? new Date();

  const websites = await listWebsites(base);
  let targets = websites.filter((w) => w.status === "maintenance");
  if (deps?.site) {
    const wanted = siteSlug(deps.site);
    targets = targets.filter((w) => siteSlug(w.name) === wanted);
  }

  const period = now.toISOString().slice(0, 7);
  const results: AnnounceSiteResult[] = [];

  for (const w of targets) {
    try {
      const scores = scoresFromRow(w);
      if (scores === null) {
        results.push({ site: w.name, status: "skipped-no-scores" });
        continue;
      }

      // Traffic + search snapshot over a ~30-day window ending now (fetchPeriodUsers derives
      // the equal-length previous window for the trend). Reuses the report pipeline's
      // soft-failing enrichment: GA/search unconfigured or an API error leaves the numbers
      // null and the email simply omits the traffic section — it never blocks the draft.
      const periodEnd = now;
      const periodStart = new Date(now.getTime() - GA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const gaUsers = (await fetchGaUsers(w, periodStart, periodEnd)).value;
      const search = (await fetchSearch(w, periodStart, periodEnd)).value;
      const enrichment: ReportEnrichment = {
        ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
        ...(search ? { searchFoundPage1: search.foundOnPage1 } : {}),
        ...(search?.foundOnPage1 && search.position !== null
          ? { searchPosition: search.position }
          : {}),
      };

      // Dedupe: reuse an existing Announcement row for this (site, period) rather than
      // stacking a second draft. The reuse path refreshes the stored scores + traffic/search
      // (and Completed on) so the eventually-sent email — which reads the row — isn't stale.
      // The create path writes them via createDraft.
      let report;
      let statusKind: "drafted" | "reused";
      const existing = await findReportByPeriod(base, w.id, "Announcement", period);
      if (existing) {
        await updateReportScores(base, existing.id, scores, now, enrichment);
        report = existing;
        statusKind = "reused";
      } else {
        report = await createDraft(base, draftInputFor(w, scores, now, period, enrichment));
        statusKind = "drafted";
      }

      const slug = siteSlug(w.name);
      const { html } = await renderReportHtml({
        siteName: w.name,
        siteUrl: w.url,
        reportType: "Announcement",
        completedOn: now,
        lighthouse: scores,
        gaUsersCurrent: gaUsers?.current,
        gaUsersPrevious: gaUsers?.previous,
        gaPeriodDays: GA_WINDOW_DAYS,
        searchPosition: search?.foundOnPage1 ? (search.position ?? undefined) : undefined,
        lastTestedDate: null,
        commentary: null,
        copy: resolveCopy(w),
        headerImageCid: `${slug}-header`,
        // cadence (the client's go-forward pace, "None" omitted) + default-on improvement
        // callouts. Shared with the send re-render via announcementSiteExtras so the sent
        // email matches this reviewed preview.
        ...announcementSiteExtras(w),
      });

      // A preview-upload hiccup must NOT fail the site — log and continue.
      try {
        await uploadAttachment(
          report.id,
          "Rendered HTML",
          html,
          `${slug}-${now.toISOString().slice(0, 10)}.html`,
          "text/html",
        );
      } catch (uploadErr) {
        console.warn(
          `⚠ Announcement preview upload skipped for ${w.name}: ${
            uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
          }`,
        );
      }

      // Critical: NOT wrapped — without queueing, the draft never enters the approve queue,
      // so a failure here must surface as an error result for the site. queueDraft also
      // supersedes any lower-tier (Maintenance/Testing) drafts queued for this site, and
      // stands down if an equal-or-higher report is already queued (single-queue rule).
      const queue = await queueDraft(base, {
        id: report.id,
        siteId: w.id,
        reportType: "Announcement",
      });

      const recipientMissing = !(w.reportRecipientsTo && w.reportRecipientsTo.trim());
      results.push({
        site: w.name,
        status: statusKind,
        reportId: report.id,
        recipientMissing,
        queued: queue.queued,
      });
    } catch (err) {
      results.push({
        site: w.name,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results };
}

/** The four stored Lighthouse scores off a Websites row, or null if ANY is missing. */
function scoresFromRow(w: WebsiteRow): LighthouseScores | null {
  if (w.pScore === null || w.rScore === null || w.bpScore === null || w.seoScore === null) {
    return null;
  }
  return {
    performance: w.pScore,
    accessibility: w.rScore,
    bestPractices: w.bpScore,
    seo: w.seoScore,
  };
}

/** Build the Announcement `DraftInput`. Announcements have no period window and no prior
 *  maintenance test, so periodStart/periodEnd/completedOn all collapse to `now` and
 *  `lastTestedDate` is null. The subject override gives the email a purpose-built line. */
function draftInputFor(
  w: WebsiteRow,
  scores: LighthouseScores,
  now: Date,
  period: string,
  enrichment: ReportEnrichment,
): Parameters<typeof createDraft>[1] {
  return {
    reportId: `${w.name} — Announcement — ${now.toISOString().slice(0, 10)}`,
    siteId: w.id,
    reportType: "Announcement",
    period,
    periodStart: now,
    periodEnd: now,
    completedOn: now,
    lighthouse: scores,
    lastTestedDate: null,
    subjectOverride: defaultReportSubject({
      name: w.name,
      url: w.url,
      type: "Announcement",
      date: now,
    }),
    ...enrichment,
  };
}
