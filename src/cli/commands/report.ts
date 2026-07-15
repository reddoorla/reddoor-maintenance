import { openBase, readAirtableConfig, type AirtableBase } from "../../reports/airtable/client.js";
import {
  listWebsites,
  siteSlug,
  updateNextDueDates,
  type WebsiteRow,
} from "../../reports/airtable/websites.js";
import { listAllReports, type ReportRow } from "../../reports/airtable/reports.js";
import { findDueReports, nextDueDate, reportPeriodKey } from "../../reports/due.js";
import { draftReportForSite } from "../../reports/draft.js";
import { reportTier } from "../../reports/queue.js";
import { readGaConfig } from "../../reports/ga/config.js";
import {
  assessAnalyticsAlert,
  composeAnalyticsAlertEmail,
  type AnalyticsRunHealth,
} from "../../alerts/analytics-health.js";
import type { ReportType } from "../../reports/types.js";

export type ReportCommandOptions = {
  due?: boolean;
  preview?: boolean;
  sendReady?: boolean;
  digest?: boolean;
  type?: string;
  cwd?: string;
};

/**
 * Summary line for a drafted report, reflecting the single-queue outcome. `queued === false`
 * means a higher-or-equal-tier report was already pending for the site, so this draft was
 * created but deliberately left OUT of the approve queue. A non-empty `supersededIds` means it
 * un-queued that many lower-tier drafts. `null` is the previewOnly path (no Airtable queue).
 */
function draftLine(
  reportId: string | undefined,
  queued: boolean | null,
  supersededIds: string[],
  verb = "drafted",
): string {
  const id = reportId ?? "(unknown)";
  if (queued === false) {
    return `• ${verb} but NOT queued: ${id} — a higher-or-equal-tier report is already pending approval`;
  }
  const sup =
    supersededIds.length > 0
      ? ` (superseded ${supersededIds.length} lower-tier draft${supersededIds.length > 1 ? "s" : ""})`
      : "";
  return `✓ ${verb}: ${id}${sup}`;
}

/**
 * Parse the single-site `--type` flag. Only Maintenance and Testing are draftable
 * this way — Launch has the `launch <site>` command and Announcement has
 * `announce <site>`, each with its own purpose-built flow. Case-insensitive;
 * defaults to Maintenance (the historical single-site behaviour). Throws an
 * exitCode-2 usage error on anything else. PURE.
 */
export function parseSingleSiteReportType(raw: string | undefined): ReportType {
  if (raw === undefined || raw.trim() === "") return "Maintenance";
  const norm = raw.trim().toLowerCase();
  if (norm === "maintenance") return "Maintenance";
  if (norm === "testing") return "Testing";
  const hint =
    norm === "launch"
      ? " — use the `launch <site>` command"
      : norm === "announcement"
        ? " — use the `announce <site>` command"
        : "";
  throw Object.assign(
    new Error(`--type must be Maintenance or Testing (got ${JSON.stringify(raw)})${hint}`),
    { exitCode: 2 },
  );
}

/** Dashboard origin for digest /s/<slug> links. DASHBOARD_BASE_URL overrides the
 *  production default; the trailing slash (if any) is trimmed by runDigest. */
function dashboardBaseUrl(): string {
  return process.env.DASHBOARD_BASE_URL?.trim() || "https://reddoor-maintenance.netlify.app";
}

export async function runReportCommand(
  slug: string | undefined,
  opts: ReportCommandOptions,
): Promise<{ output: string; code: number }> {
  if (opts.digest) {
    const { runDigest } = await import("../../reports/digest.js");
    return runDigest({ baseUrl: dashboardBaseUrl() });
  }

  if (opts.sendReady) {
    const { sendApprovedReports } = await import("../../reports/send/orchestrate.js");
    return sendApprovedReports();
  }

  if (opts.due) {
    return runDueDraft();
  }

  if (slug) {
    // Validate the type BEFORE any Airtable access so a bad --type fails fast (and
    // without needing credentials).
    const reportType = parseSingleSiteReportType(opts.type);
    return runSingleSiteDraft(slug, { previewOnly: Boolean(opts.preview), reportType });
  }

  throw Object.assign(
    new Error(
      "Usage: reddoor-maint report [<slug>] [--type <Maintenance|Testing>] [--due] [--preview] [--send-ready] [--digest]",
    ),
    {
      exitCode: 2,
    },
  );
}

async function runDueDraft(): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const result = await draftDueReports(base, new Date());
  await alertOnFleetAnalyticsFailure(result.health);
  return { output: result.output, code: result.code };
}

/** Best-effort: when a draft run's GA/Search soft-failures look FLEET-WIDE (the shared
 *  GA_SUBJECT lost access — see assessAnalyticsAlert), email the operator one alert.
 *  NEVER throws — a Resend or config hiccup must not fail the nightly draft cron; the
 *  per-site `⚠ GA skipped` warnings + the run-output line still carry the signal. The
 *  daily idempotency key dedupes multiple runs in one day (Resend dedupes 24h). */
async function alertOnFleetAnalyticsFailure(health: AnalyticsRunHealth): Promise<void> {
  if (!assessAnalyticsAlert(health).fire) return;
  try {
    const to = process.env.OPERATOR_EMAIL?.trim() || "info@reddoorla.com";
    const { subject, html } = composeAnalyticsAlertEmail(health, dashboardBaseUrl());
    const { defaultResendClient } = await import("../../reports/send/resend.js");
    await defaultResendClient().send({
      from: "Reddoor Reports <reports@reddoorla.com>",
      to: [to],
      subject,
      html,
      idempotencyKey: `analytics-alert-${new Date().toISOString().slice(0, 10)}`,
    });
    console.warn(`⚠ ${subject} — operator alerted (${to})`);
  } catch (e) {
    console.warn(`⚠ analytics-failure alert send failed: ${(e as Error).message}`);
  }
}

/**
 * Write each site's code-computed next-maintenance / next-testing date back to Airtable
 * (date-only, or null when there's no schedule), so the "next" dates shown there derive
 * from the SAME `nextDueDate` the scheduler uses — replacing the old Airtable formula +
 * automation. Best-effort and per-site isolated: a missing `Next … at` column or one bad
 * row warns and is skipped, never aborting the nightly draft run.
 */
async function writeNextDueDates(
  base: AirtableBase,
  websites: WebsiteRow[],
  reports: ReportRow[],
  today: Date,
): Promise<void> {
  const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
  for (const site of websites) {
    try {
      await updateNextDueDates(base, site.id, {
        maintenanceAt: ymd(nextDueDate(site, reports, "Maintenance", today)),
        testingAt: ymd(nextDueDate(site, reports, "Testing", today)),
      });
    } catch (e) {
      console.warn(`⚠ next-due write skipped for ${site.name}: ${(e as Error).message}`);
    }
  }
}

export async function draftDueReports(
  base: AirtableBase,
  today: Date,
): Promise<{ output: string; code: number; health: AnalyticsRunHealth }> {
  const websites = await listWebsites(base);
  // ONE unfiltered fetch for the whole fleet. Per-site queries can't be pushed to
  // Airtable anyway (linked-record fields aren't formula-filterable by record id),
  // and findDueReports + the period guard below match on siteId in memory.
  const reports = await listAllReports(base);

  // Refresh every site's code-owned next-due dates first, so they stay current even on
  // a run where nothing is due (the early return below).
  await writeNextDueDates(base, websites, reports, today);

  const due = findDueReports(websites, reports, today);

  // GA/Search enrichment is configured globally (the impersonation subject) AND
  // per-site (a GA4 property or a search query). `gaConfigured` is the global half;
  // the per-site half is checked as each draft runs, to build the fleet-wide
  // analytics-failure alert's denominator (see alertOnFleetAnalyticsFailure).
  const gaConfigured = readGaConfig() !== null;
  // Truthy (not `!== null`) to mirror fetchGaUsers/fetchSearch's own gate exactly
  // (`!siteRow.ga4PropertyId`), so an empty-string cell counts as not-configured in
  // BOTH places and can't inflate the alert denominator.
  const isAnalyticsConfigured = (s: WebsiteRow): boolean =>
    gaConfigured && Boolean(s.ga4PropertyId || s.searchQuery);

  if (due.length === 0) {
    return {
      output: "No reports due.",
      code: 0,
      health: { softFailedSites: 0, configuredSites: 0 },
    };
  }

  const lines: string[] = [];
  let softFailedSites = 0;
  let searchDefaultMisses = 0;
  let gaConfiguredSites = 0;
  let skipped = 0;
  for (const item of due) {
    // Idempotency: a re-run must not re-draft a (site, type) already drafted this
    // recurrence. The dueDate's YYYY-MM is the stable per-cycle key. Match against the
    // reports we already fetched — no extra query on the hot path.
    const period = reportPeriodKey(item.dueDate);
    const existing = reports.find(
      (r) => r.siteId === item.site.id && r.reportType === item.reportType && r.period === period,
    );

    // A row already exists for THIS period. Two cases:
    //   - Draft ready → truly done, skip (the idempotent re-run path).
    //   - NOT ready → a crash between createDraft and setDraftReady wedged it: the
    //     row exists (so we never re-draft) yet it's never sendable (listSendable
    //     needs Draft ready). COMPLETE it in place instead of skipping forever —
    //     re-render → re-upload the HTML → flip Draft ready on the EXISTING row.
    if (existing) {
      if (existing.draftReady) {
        skipped++;
        lines.push(`• skipped (already drafted ${period}): ${item.site.name} ${item.reportType}`);
        continue;
      }
      // A not-ready row is normally a crash between createDraft and setDraftReady — re-complete
      // it in place. BUT queueDraft also clears Draft ready on rows it supersedes/blocks, and
      // those must NOT be re-completed: doing so would re-render and APPEND a duplicate HTML
      // attachment every nightly run, only to be re-blocked. Distinguish the two: if a
      // higher-or-equal-tier report is still pending for this site, this row was intentionally
      // un-queued (not crashed) — skip it until the blocker is sent/approved or the month rolls.
      const blockedByPending = reports.some(
        (r) =>
          r.siteId === item.site.id &&
          r.id !== existing.id &&
          r.sentAt === null &&
          r.draftReady &&
          reportTier(r.reportType) >= reportTier(item.reportType),
      );
      if (blockedByPending) {
        skipped++;
        lines.push(
          `• skipped (superseded — a higher-or-equal-tier report is pending): ${item.site.name} ${item.reportType}`,
        );
        continue;
      }
      try {
        const result = await draftReportForSite(base, item.site, item.reportType, {
          period,
          completeRowId: existing.id,
          existingRow: existing,
        });
        existing.draftReady = result.queued === true;
        lines.push(
          draftLine(
            result.reportRow?.reportId ?? existing.reportId,
            result.queued,
            result.supersededIds,
            "completed half-made draft",
          ),
        );
        if (isAnalyticsConfigured(item.site)) gaConfiguredSites++;
        if (result.softFailures.length > 0) softFailedSites++;
        if (result.searchDefaultMissed) searchDefaultMisses++;
      } catch (e) {
        lines.push(`✗ failed: ${item.site.name} ${item.reportType} — ${(e as Error).message}`);
      }
      continue;
    }

    // Pile-up guard: don't accrue a fresh new-period draft every recurrence for a
    // site nobody ever approves. The period key follows the DUE month, so each
    // recurrence wants a new (later-period) draft — but if a PRIOR draft is still
    // pending approval, a new one just stacks. Skip creating the new one while an
    // earlier-period draft for this (site, type) sits ready-but-unsent.
    //
    // `r.draftReady` is load-bearing: a draft a higher tier SUPERSEDED has
    // draftReady=false and never gets a Sent at, so without this clause it would
    // match (sentAt null + earlier period) and block EVERY future draft for the
    // site forever. Pending-approval means draftReady=true AND sentAt=null.
    const pendingEarlier = reports.find(
      (r) =>
        r.siteId === item.site.id &&
        r.reportType === item.reportType &&
        r.draftReady &&
        r.sentAt === null &&
        r.period !== null &&
        r.period < period,
    );
    if (pendingEarlier) {
      skipped++;
      lines.push(
        `• skipped: ${item.site.name} ${item.reportType} already has an unsent ${pendingEarlier.period} draft pending approval`,
      );
      continue;
    }

    try {
      // Pass the SAME key the guard searches by, so the stamped Period always
      // matches a future run's reportPeriodKey(dueDate) — even if this run lags
      // into a later month than the dueDate.
      const result = await draftReportForSite(base, item.site, item.reportType, { period });
      lines.push(draftLine(result.reportRow?.reportId, result.queued, result.supersededIds));
      // Keep the in-memory snapshot current so the guard's `.some()` check on the
      // NEXT iteration of this same run catches a row we JUST created — rather than
      // relying on findDueReports never emitting two items for the same (site, type).
      if (result.reportRow) reports.push(result.reportRow);
      // Count sites (not individual GA/Search failures) so a fleet-wide enrichment
      // outage is one obvious line at the bottom, not 200 buried console.warns.
      if (isAnalyticsConfigured(item.site)) gaConfiguredSites++;
      if (result.softFailures.length > 0) softFailedSites++;
      if (result.searchDefaultMissed) searchDefaultMisses++;
    } catch (e) {
      lines.push(`✗ failed: ${item.site.name} ${item.reportType} — ${(e as Error).message}`);
    }
  }
  if (skipped > 0) {
    lines.push(`• ${skipped} already drafted or pending this period`);
  }
  if (softFailedSites > 0) {
    lines.push(
      `⚠ ${softFailedSites} site${softFailedSites === 1 ? "" : "s"} had GA/Search enrichment fail — drafted with blank analytics; check the logs above`,
    );
  }
  if (searchDefaultMisses > 0) {
    lines.push(
      `⚑ ${searchDefaultMisses} site${searchDefaultMisses === 1 ? "" : "s"} returned no Search Console data for their name — set an explicit "Search query" in Airtable to track brand presence.`,
    );
  }
  return {
    output: lines.join("\n"),
    code: lines.some((l) => l.startsWith("✗")) ? 1 : 0,
    health: { softFailedSites, configuredSites: gaConfiguredSites },
  };
}

async function runSingleSiteDraft(
  slug: string,
  opts: { previewOnly: boolean; reportType: ReportType },
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const site = websites.find((w) => siteSlug(w.name) === slug);
  if (!site) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }
  const result = await draftReportForSite(opts.previewOnly ? null : base, site, opts.reportType, {
    previewOnly: opts.previewOnly,
  });
  if (opts.previewOnly) {
    return { output: `Preview written to ${result.htmlPath}`, code: 0 };
  }
  return {
    output: draftLine(
      result.reportRow?.reportId,
      result.queued,
      result.supersededIds,
      "Draft created",
    ),
    code: 0,
  };
}
