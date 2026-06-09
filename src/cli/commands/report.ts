import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../../reports/airtable/websites.js";
import { listReportsForSite } from "../../reports/airtable/reports.js";
import { findDueReports } from "../../reports/due.js";
import { draftReportForSite } from "../../reports/draft.js";

export type ReportCommandOptions = {
  due?: boolean;
  preview?: boolean;
  sendReady?: boolean;
  cwd?: string;
};

export async function runReportCommand(
  slug: string | undefined,
  opts: ReportCommandOptions,
): Promise<{ output: string; code: number }> {
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
    new Error("Usage: reddoor-maint report [<slug>] [--due] [--preview] [--send-ready]"),
    {
      exitCode: 2,
    },
  );
}

async function runDueDraft(): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const reports = [];
  for (const w of websites) {
    const rs = await listReportsForSite(base, w.id);
    reports.push(...rs);
  }
  const due = findDueReports(websites, reports, new Date());

  if (due.length === 0) return { output: "No reports due.", code: 0 };

  const lines: string[] = [];
  let softFailedSites = 0;
  for (const item of due) {
    try {
      const result = await draftReportForSite(base, item.site, item.reportType);
      lines.push(`✓ drafted: ${result.reportRow?.reportId}`);
      // Count sites (not individual GA/Search failures) so a fleet-wide enrichment
      // outage is one obvious line at the bottom, not 200 buried console.warns.
      if (result.softFailures.length > 0) softFailedSites++;
    } catch (e) {
      lines.push(`✗ failed: ${item.site.name} ${item.reportType} — ${(e as Error).message}`);
    }
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
