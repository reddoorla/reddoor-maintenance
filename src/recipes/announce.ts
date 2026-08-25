import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug, updateAnalyticsHealth } from "../reports/airtable/websites.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { readGaConfig } from "../reports/ga/config.js";
import {
  createDraft,
  findReportByPeriod,
  updateReportScores,
  type ReportEnrichment,
} from "../reports/airtable/reports.js";
import type { ReportMirror } from "../reports/report-mirror.js";
import { queueDraft } from "../reports/queue.js";
import { uploadAttachment } from "../reports/airtable/attachments.js";
import { renderReportHtml } from "../reports/render.js";
import { resolveCopy } from "../reports/copy.js";
import { fetchGaUsers, fetchSearch, refreshHeaderImage } from "../reports/draft.js";
import type { RefreshHeaderDeps } from "../reports/draft.js";
import { announcementSiteExtras } from "../reports/announcement-email/template.js";
import type { LighthouseScores } from "../reports/types.js";
import { defaultReportSubject } from "../reports/subject.js";
import { scoresFromRow } from "../reports/report-data.js";

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
  /**
   * Header-image refresh, matching `draftReportForSite`'s opt-out shape: UNSET means
   * refresh (the production default), `false` skips it so unit suites don't launch a
   * browser. Announce previously never refreshed at all, so a site whose stored header
   * predated a plate change kept announcing with the old one until its next
   * Maintenance/Testing draft happened to heal it.
   */
  refreshHeader?: RefreshHeaderDeps | false;
  /** #539 Phase 5: Turso write-through for everything this recipe writes — the
   *  created row (or a reused row's refreshed scores), the rendered body, and
   *  the queue flag. Not defaulted here — every unit test calls `announce` with
   *  a fake base, and a default would open a real libSQL handle from inside the
   *  suite. The CLI composition root wires it. */
  reportMirror?: ReportMirror;
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
  let targets = websites.filter((w) => w.status === "maintained");
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

      // Refresh BEFORE the render so a queued announcement always has a current header
      // stored — the send re-reads the attachment, so a stale one here reaches the
      // client. Best-effort by construction: refreshHeaderImage returns false and never
      // throws, so a capture failure leaves the stored image and the draft continues.
      if (deps?.refreshHeader !== false) {
        await refreshHeaderImage(w, deps?.refreshHeader ?? {});
      }

      // Traffic + search snapshot over a ~30-day window ending now (fetchPeriodUsers derives
      // the equal-length previous window for the trend). Reuses the report pipeline's
      // soft-failing enrichment: GA/search unconfigured or an API error leaves the numbers
      // null and the email simply omits the traffic section — it never blocks the draft.
      const periodEnd = now;
      const periodStart = new Date(now.getTime() - GA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const gaResult = await fetchGaUsers(w, periodStart, periodEnd);
      const searchResult = await fetchSearch(w, periodStart, periodEnd);
      const gaUsers = gaResult.value;
      const search = searchResult.value;
      const enrichment: ReportEnrichment = {
        ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
        ...(search ? { searchFoundPage1: search.foundOnPage1 } : {}),
        ...(search?.foundOnPage1 && search.position !== null
          ? { searchPosition: search.position }
          : {}),
      };

      // Record this site's GA/Search enrichment health for the per-site analytics-failure
      // signal (cockpit/digest) — exactly as the `--due` draft path does. Without this, an
      // announcement-time GA outage hides the traffic block with NO operator signal (it reads
      // identically to "site has no GA configured"). Set the timestamp on a soft-fail, clear
      // it on a clean enrichment so the signal self-heals. Best-effort: the column is
      // operator-added, so until it exists the write throws — which must not break the draft.
      if (readGaConfig() !== null && Boolean(w.ga4PropertyId || w.searchQuery)) {
        try {
          await updateAnalyticsHealth(
            base,
            w.id,
            gaResult.softFailed || searchResult.softFailed ? now.toISOString() : null,
          );
        } catch (e) {
          console.warn(`⚠ analytics-health write skipped for ${w.name}: ${(e as Error).message}`);
        }
      }

      // Dedupe: reuse an existing Announcement row for this (site, period) rather than
      // stacking a second draft. The reuse path refreshes the stored scores + traffic/search
      // (and Completed on) so the eventually-sent email — which reads the row — isn't stale.
      // The create path writes them via createDraft.
      let report;
      let statusKind: "drafted" | "reused";
      const existing = await findReportByPeriod(base, w.id, "Announcement", period);
      if (existing) {
        await updateReportScores(base, existing.id, scores, now, enrichment);
        // Mirror the SAME refresh: the reuse path exists so the eventually-sent
        // email is not stale, and the console reads those numbers too.
        await deps?.reportMirror?.patch(existing.id, {
          lighthouse_performance: scores.performance,
          lighthouse_accessibility: scores.accessibility,
          lighthouse_best_practices: scores.bestPractices,
          lighthouse_seo: scores.seo,
          completed_on: now.toISOString().slice(0, 10),
          ...(enrichment.gaUsersCurrent !== undefined
            ? { ga_users_current: enrichment.gaUsersCurrent }
            : {}),
          ...(enrichment.gaUsersPrevious !== undefined
            ? { ga_users_previous: enrichment.gaUsersPrevious }
            : {}),
          ...(enrichment.searchFoundPage1 !== undefined
            ? { search_found_page1: enrichment.searchFoundPage1 ? 1 : 0 }
            : {}),
          ...(enrichment.searchPosition !== undefined
            ? { search_position: enrichment.searchPosition }
            : {}),
        });
        report = existing;
        statusKind = "reused";
      } else {
        report = await createDraft(
          base,
          draftInputFor(w, scores, now, period, enrichment),
          deps?.reportMirror?.created,
        );
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
        // Store the same body in Turso — the console's preview route reads it
        // there, not from the Airtable attachment (whose URL expires).
        await deps?.reportMirror?.body(report.id, html);
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
      const queue = await queueDraft(
        base,
        { id: report.id, siteId: w.id, reportType: "Announcement" },
        deps?.reportMirror,
      );

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
