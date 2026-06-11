import { openBase, readAirtableConfig, type AirtableBase } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../../reports/airtable/websites.js";
import { listAllReports } from "../../reports/airtable/reports.js";
import { findDueReports, reportPeriodKey } from "../../reports/due.js";
import { draftReportForSite } from "../../reports/draft.js";

export type ReportCommandOptions = {
  due?: boolean;
  preview?: boolean;
  sendReady?: boolean;
  digest?: boolean;
  cwd?: string;
};

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
    return runSingleSiteDraft(slug, { previewOnly: Boolean(opts.preview) });
  }

  throw Object.assign(
    new Error("Usage: reddoor-maint report [<slug>] [--due] [--preview] [--send-ready] [--digest]"),
    {
      exitCode: 2,
    },
  );
}

async function runDueDraft(): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  return draftDueReports(base, new Date());
}

export async function draftDueReports(
  base: AirtableBase,
  today: Date,
): Promise<{ output: string; code: number }> {
  const websites = await listWebsites(base);
  // ONE unfiltered fetch for the whole fleet. Per-site queries can't be pushed to
  // Airtable anyway (linked-record fields aren't formula-filterable by record id),
  // and findDueReports + the period guard below match on siteId in memory.
  const reports = await listAllReports(base);
  const due = findDueReports(websites, reports, today);

  if (due.length === 0) return { output: "No reports due.", code: 0 };

  const lines: string[] = [];
  let softFailedSites = 0;
  let skipped = 0;
  for (const item of due) {
    // Idempotency: a re-run must not re-draft a (site, type) already drafted this
    // recurrence. The dueDate's YYYY-MM is the stable per-cycle key. Match against the
    // reports we already fetched — no extra query on the hot path.
    const period = reportPeriodKey(item.dueDate);
    const already = reports.some(
      (r) => r.siteId === item.site.id && r.reportType === item.reportType && r.period === period,
    );
    if (already) {
      skipped++;
      lines.push(`• skipped (already drafted ${period}): ${item.site.name} ${item.reportType}`);
      continue;
    }
    try {
      // Pass the SAME key the guard searches by, so the stamped Period always
      // matches a future run's reportPeriodKey(dueDate) — even if this run lags
      // into a later month than the dueDate.
      const result = await draftReportForSite(base, item.site, item.reportType, { period });
      lines.push(`✓ drafted: ${result.reportRow?.reportId}`);
      // Keep the in-memory snapshot current so the guard's `.some()` check on the
      // NEXT iteration of this same run catches a row we JUST created — rather than
      // relying on findDueReports never emitting two items for the same (site, type).
      if (result.reportRow) reports.push(result.reportRow);
      // Count sites (not individual GA/Search failures) so a fleet-wide enrichment
      // outage is one obvious line at the bottom, not 200 buried console.warns.
      if (result.softFailures.length > 0) softFailedSites++;
    } catch (e) {
      lines.push(`✗ failed: ${item.site.name} ${item.reportType} — ${(e as Error).message}`);
    }
  }
  if (skipped > 0) {
    lines.push(`• ${skipped} already drafted this period`);
  }
  if (softFailedSites > 0) {
    lines.push(
      `⚠ ${softFailedSites} site${softFailedSites === 1 ? "" : "s"} had GA/Search enrichment fail — drafted with blank analytics; check the logs above`,
    );
  }
  return { output: lines.join("\n"), code: lines.some((l) => l.startsWith("✗")) ? 1 : 0 };
}

async function runSingleSiteDraft(
  slug: string,
  opts: { previewOnly: boolean },
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const site = websites.find((w) => siteSlug(w.name) === slug);
  if (!site) {
    throw Object.assign(new Error(`No Websites row matched slug "${slug}"`), { exitCode: 2 });
  }
  const result = await draftReportForSite(opts.previewOnly ? null : base, site, "Maintenance", {
    previewOnly: opts.previewOnly,
  });
  if (opts.previewOnly) {
    return { output: `Preview written to ${result.htmlPath}`, code: 0 };
  }
  return { output: `Draft created: ${result.reportRow?.reportId}`, code: 0 };
}
