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
import type { ScheduleMirror } from "../../audits/health-mirror.js";
import type { ReportMirror } from "../../reports/report-mirror.js";
import type { SiteMirror } from "../../db/site-mirror.js";
import { operatorEmail } from "../../util/operator.js";

export type ReportCommandOptions = {
  due?: boolean;
  preview?: boolean;
  enrich?: boolean;
  sendReady?: boolean;
  digest?: boolean;
  rerender?: string;
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
    // #539 Phase 5: a Launch send flips Status + stamps `Launched at` on the
    // Websites row; #643 retired the hourly sync, so these mirrors are the ONLY
    // way either write reaches Turso.
    const { makeSiteMirror } = await import("../../db/site-mirror.js");
    const { mirrorWrite } = await import("../../db/freeze.js");
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { mirrorReportPatch } = await import("../../db/fleet-state.js");
    return sendApprovedReports({
      siteMirror: await makeSiteMirror(),
      // stampSent's Turso shadow, routed through mirrorWrite so the freeze
      // switch owns the semantics: strict rethrows and the send loop reds the
      // run. Mirrors stampSent exactly — the 409 replay path leaves Airtable's
      // `Resend message ID` untouched, so the shadow omits it there too.
      reportSentMirror: (reportId, sentAt, messageId) =>
        mirrorWrite(`stamp-sent ${reportId}`, async () => {
          const db = await openDb(readDbConfig());
          await mirrorReportPatch(db, reportId, {
            sent_at: sentAt.toISOString(),
            ...(messageId !== null ? { resend_message_id: messageId } : {}),
          });
        }),
    });
  }

  // Refresh ONE unsent report's stored body so the console preview reflects
  // commentary edited after drafting. Runs here rather than in a Netlify
  // function because rendering needs sharp — see rerender.ts.
  if (opts.rerender) {
    const { rerenderReport, formatRerenderResult } = await import("../../reports/send/rerender.js");
    const { renderReportFromRow } = await import("../../reports/send/render-from-row.js");
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { getReportById, getSiteById, storeRenderedHtml } =
      await import("../../db/fleet-state.js");
    const { loadHeaderImage } = await import("../../db/header-images.js");
    const { fetchAttachmentBytes } = await import("../../reports/airtable/attachments.js");
    const db = await openDb(readDbConfig());
    const result = await rerenderReport(
      {
        getReport: (id) => getReportById(db, id),
        getSite: (id) => getSiteById(db, id),
        loadHeaderPlate: async (id) => (await loadHeaderImage(db, id))?.bytes ?? null,
        fetchAirtableHeader: async (url) => (await fetchAttachmentBytes(url)).bytes,
        render: (site, report, plate) => renderReportFromRow(site, report, plate),
        store: (id, html) => storeRenderedHtml(db, id, html),
      },
      opts.rerender,
    );
    // Exit 1 on anything but a render, so a dispatched run that refused is RED
    // rather than a green run that silently changed nothing.
    return { output: formatRerenderResult(result), code: result.status === "rendered" ? 0 : 1 };
  }

  if (opts.due) {
    return runDueDraft();
  }

  if (slug) {
    // Validate the type BEFORE any Airtable access so a bad --type fails fast (and
    // without needing credentials).
    const reportType = parseSingleSiteReportType(opts.type);
    return runSingleSiteDraft(slug, {
      previewOnly: Boolean(opts.preview),
      enrich: Boolean(opts.enrich),
      reportType,
    });
  }

  throw Object.assign(
    new Error(
      "Usage: reddoor-maint report [<slug>] [--type <Maintenance|Testing>] [--due] [--preview] [--enrich] [--send-ready] [--digest]",
    ),
    {
      exitCode: 2,
    },
  );
}

async function runDueDraft(): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  // Phase 3 dual-write (#539): mirror real next-due writes into site_schedule.
  // Null when libSQL creds are absent — the Airtable path is unchanged.
  const { makeScheduleMirrorBestEffort } = await import("../../audits/health-mirror.js");
  // Phase 5 dual-write (#539): mirror this batch's report writes — the created
  // rows, their bodies, and the queue flags. Unlike the schedule mirror this is
  // never null — creds-absent is reported on the REPORT_MIRROR line rather than
  // being indistinguishable from success, the failure mode that hid #585.
  const { makeReportMirror } = await import("../../reports/report-mirror.js");
  const { makeSiteMirror } = await import("../../db/site-mirror.js");
  const result = await draftDueReports(
    base,
    new Date(),
    await makeScheduleMirrorBestEffort(),
    await makeReportMirror(),
    await makeSiteMirror(),
  );
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
    const to = operatorEmail();
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
 *
 * The diff-guard (#539 Phase 3): a site whose computed dates equal what its row
 * already holds is SKIPPED — before it, every one of the 44 sites got a nightly
 * write while only the handful whose schedule actually moved needed one (a
 * never-maintained site re-wrote null over null forever). This also scopes the
 * write to maintained sites by construction: no schedule → computed null →
 * equal to the stored null → skipped. Each real write dual-writes through
 * `scheduleMirror` into site_schedule (null mirror = Turso creds absent; the
 * hourly sync converges either way). The NEXT_DUE_WRITE line is observability,
 * not a CI gate — nothing greps it yet.
 */
export async function writeNextDueDates(
  base: AirtableBase,
  websites: WebsiteRow[],
  reports: ReportRow[],
  today: Date,
  scheduleMirror: ScheduleMirror | null = null,
): Promise<void> {
  const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
  let wrote = 0;
  let skipped = 0;
  let failed = 0;
  let mirrored = 0;
  let mirrorFailed = 0;
  let mirrorMissed = 0;
  for (const site of websites) {
    // The whole per-site body sits in ONE try — compute included — so a bad
    // row can only cost its own write, exactly the pre-diff-guard blast radius.
    try {
      const maintenanceAt = ymd(nextDueDate(site, reports, "Maintenance", today));
      const testingAt = ymd(nextDueDate(site, reports, "Testing", today));
      if (maintenanceAt === site.nextMaintenanceAt && testingAt === site.nextTestingAt) {
        skipped++;
        continue;
      }
      const fields = await updateNextDueDates(base, site.id, { maintenanceAt, testingAt });
      wrote++;
      if (scheduleMirror) {
        try {
          // false = the UPDATE matched no site_schedule row (site created in
          // Airtable since the last hourly import) — missed, not mirrored.
          if (await scheduleMirror(site.id, fields, today.toISOString())) mirrored++;
          else mirrorMissed++;
        } catch (e) {
          mirrorFailed++;
          console.warn(`⚠ [schedule-mirror] ${site.name}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      failed++;
      console.warn(`⚠ next-due write skipped for ${site.name}: ${(e as Error).message}`);
    }
  }
  // failed= keeps a write outage visible: without it wrote+skipped silently
  // undercounts, and a FULL outage prints wrote=0 skipped=0 — indistinguishable
  // from an empty fleet.
  // A null mirror writes nothing and throws nothing, so its only trace used to
  // be an ABSENT suffix — which reads exactly like a healthy run. `mirror=absent`
  // states it instead. Counters stay off in that case deliberately: `mirrored=0`
  // would claim a write that returned nothing, not one that was never attempted.
  const mirrorNote = scheduleMirror
    ? ` mirrored=${mirrored} mirror_failed=${mirrorFailed} mirror_missed=${mirrorMissed}`
    : " mirror=absent";
  console.log(`NEXT_DUE_WRITE wrote=${wrote} skipped=${skipped} failed=${failed}${mirrorNote}`);
}

export async function draftDueReports(
  base: AirtableBase,
  today: Date,
  scheduleMirror: ScheduleMirror | null = null,
  /** #539 Phase 5: Turso write-through for rows this batch CREATES. Forwarded
   *  to every draftReportForSite call — the nightly batch is the only unattended
   *  creator of report rows, so a dropped pass-through leaves each new draft
   *  invisible to the Turso-backed console. */
  reportMirror?: ReportMirror,
  /** #539 Phase 5: the Websites-row twin — drafting stamps `Analytics soft-fail
   *  at` on the SITE row, a different Turso table from the report. */
  siteMirror?: SiteMirror,
): Promise<{ output: string; code: number; health: AnalyticsRunHealth }> {
  const mirrorOpt = {
    ...(reportMirror ? { reportMirror } : {}),
    ...(siteMirror ? { siteMirror } : {}),
  };
  const websites = await listWebsites(base);
  // ONE unfiltered fetch for the whole fleet. Per-site queries can't be pushed to
  // Airtable anyway (linked-record fields aren't formula-filterable by record id),
  // and findDueReports + the period guard below match on siteId in memory.
  const reports = await listAllReports(base);

  // Refresh every site's code-owned next-due dates first, so they stay current even on
  // a run where nothing is due (the early return below).
  await writeNextDueDates(base, websites, reports, today, scheduleMirror);

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
  let searchPropertiesMissing = 0;
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
          ...mirrorOpt,
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
        if (result.searchPropertyMissing) searchPropertiesMissing++;
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
      const result = await draftReportForSite(base, item.site, item.reportType, {
        period,
        ...mirrorOpt,
      });
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
      if (result.searchPropertyMissing) searchPropertiesMissing++;
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
  if (searchPropertiesMissing > 0) {
    lines.push(
      `⚑ ${searchPropertiesMissing} site${searchPropertiesMissing === 1 ? "" : "s"} matched NO Search Console property — verify the domain property exists and the service account has access (a "Search query" change cannot fix this).`,
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
  opts: { previewOnly: boolean; enrich: boolean; reportType: ReportType },
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const site = websites.find((w) => siteSlug(w.name) === slug);
  if (!site) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }
  // Phase 5 dual-write (#539) — but only on the path that actually creates a
  // row. A preview writes nothing to Airtable, so opening a libSQL handle for
  // it would be pure cost (and `report --preview` is the one draft path that
  // deliberately does no store IO at all).
  const reportMirror = opts.previewOnly
    ? null
    : await (await import("../../reports/report-mirror.js")).makeReportMirror();
  const siteMirror = opts.previewOnly
    ? null
    : await (await import("../../db/site-mirror.js")).makeSiteMirror();
  const result = await draftReportForSite(opts.previewOnly ? null : base, site, opts.reportType, {
    previewOnly: opts.previewOnly,
    // Only forced on. Left undefined, draftReportForSite keeps its default
    // (enrich iff there is a base), so the real drafting path is untouched.
    ...(opts.enrich ? { enrich: true } : {}),
    ...(reportMirror ? { reportMirror } : {}),
    ...(siteMirror ? { siteMirror } : {}),
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
