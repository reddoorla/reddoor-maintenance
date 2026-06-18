import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReportType, LighthouseScores } from "./types.js";
import { renderReportHtml } from "./render.js";
import { siteSlug } from "./airtable/websites.js";
import { resolveCopy } from "./copy.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import { createDraft, listReportsForSite } from "./airtable/reports.js";
import { queueDraft } from "./queue.js";
import { uploadAttachment } from "./airtable/attachments.js";
import type { AirtableBase } from "./airtable/client.js";
import { readGaConfig } from "./ga/config.js";
import { fetchPeriodUsers } from "./ga/client.js";
import { fetchSearchPresence } from "./search/client.js";
import type { SearchPresence } from "./search/client.js";

export type DraftOptions = {
  /** Where to write the local preview HTML when `previewOnly`. Defaults to `reports/<slug>/draft.html`. */
  previewPath?: string;
  /** If true: render locally only, never touch Airtable. */
  previewOnly?: boolean;
  /** UTC "YYYY-MM" recurrence key; falls back to periodEnd's month when omitted. */
  period?: string;
  /** Airtable record id of an EXISTING (not-ready) row to COMPLETE in place rather
   *  than creating a new one. When set, we skip createDraft and only re-render →
   *  upload the HTML attachment → flip Draft ready on this row. Used by the --due
   *  re-draft path to finish a draft whose createDraft succeeded but whose
   *  setDraftReady never ran (a crash mid-sequence wedged the period). */
  completeRowId?: string;
  /** The mapped ReportRow being completed, returned as `reportRow` from the
   *  complete path so callers keep the same shape they get on the create path. */
  existingRow?: ReportRow;
};

/** An enrichment fetch that *errored* (not one that was legitimately skipped
 *  because it isn't configured / the site lacks the inputs). Surfaced so a
 *  fleet-wide GA/Search outage is visible in a `--due` batch summary instead of
 *  hiding behind one easily-missed console.warn per site. */
export type SoftFailure = "ga" | "search";

export type DraftResult = {
  /** null when previewOnly. */
  reportRow: ReportRow | null;
  /** Path to the local preview file (only set when previewOnly). */
  htmlPath: string | null;
  /** Always present — the rendered HTML string. */
  html: string;
  /** Enrichment fetches that errored for this site (empty on success or skip). */
  softFailures: SoftFailure[];
  /** Whether the draft was placed in the approve queue. False when a higher-or-equal-tier
   *  report is already queued for the site (single-queue rule); null on the previewOnly path. */
  queued: boolean | null;
  /** Ids of lower-tier queued reports this draft superseded (un-queued). */
  supersededIds: string[];
};

function scoresFromWebsite(siteRow: WebsiteRow): LighthouseScores {
  const { pScore, rScore, bpScore, seoScore } = siteRow;
  if (pScore === null || rScore === null || bpScore === null || seoScore === null) {
    throw new Error(
      `Site '${siteRow.name}' is missing one or more Lighthouse scores on the Websites row (pScore, rScore, bpScore, seoScore). ` +
        `Run 'reddoor-maint audit lighthouse' from the site's checkout and paste the four numbers into Airtable, then retry.`,
    );
  }
  return { performance: pScore, accessibility: rScore, bestPractices: bpScore, seo: seoScore };
}

function daysAgo(today: Date, n: number): Date {
  // UTC accessors to stay TZ-consistent with `due.ts` (and avoid landing
  // Airtable's `Period start` on a different calendar day than the operator
  // expects on late-night runs near a month boundary). See morning brief
  // 2026-05-29 (M1) for context.
  const out = new Date(today);
  out.setUTCDate(out.getUTCDate() - n);
  return out;
}

/**
 * Render and create an Airtable draft for one site.
 *
 * No idempotency guard here — the recurrence guard lives in draftDueReports
 * (cli/commands/report.ts), keyed on reportPeriodKey(dueDate).  The manual
 * single-site path intentionally always drafts (an operator asking for a draft
 * gets one).  findReportByPeriod (airtable/reports.ts) is the real-Airtable
 * point lookup available to dashboard/digest callers that need the same
 * idempotency guarantee outside the CLI batch loop.
 */
export async function draftReportForSite(
  base: AirtableBase | null,
  siteRow: WebsiteRow,
  reportType: ReportType,
  options: DraftOptions = {},
): Promise<DraftResult> {
  const scores = scoresFromWebsite(siteRow);

  const today = new Date();
  const slug = siteSlug(siteRow.name);

  const periodStart =
    base !== null ? await derivePeriodStart(base, siteRow, reportType, today) : daysAgo(today, 30);

  const periodEnd = today;
  const completedOn = today;
  // "Last Tested" on the Maintenance email is the REAL timestamp of the most recent automated
  // Lighthouse audit — stamped live on the Websites row (`Last lighthouse audit at`) by
  // `audit lighthouse --write-airtable` every time the scores refresh. It is deliberately NOT
  // the `testing day` field: that's the recurrence anchor consumed by due.ts and is hand-set, so
  // it goes stale. Reading the audit timestamp keeps the date current with no manual upkeep.
  const lastTestedDate =
    reportType === "Maintenance" && siteRow.lastLighthouseAuditAt
      ? new Date(siteRow.lastLighthouseAuditAt)
      : null;

  // GA enrichment (real path only). Soft-fail: any GA problem leaves the numbers null so
  // the draft still proceeds (operator fills them manually) — GA is an enhancement, not a
  // gate. Rendered with the fetched numbers so the review HTML matches the Airtable fields.
  // An *error* (vs a legitimate not-configured skip) is recorded in softFailures so the
  // caller can surface a fleet-wide outage in the batch summary.
  const gaResult =
    base !== null ? await fetchGaUsers(siteRow, periodStart, periodEnd) : NO_ENRICHMENT;
  const searchResult =
    base !== null ? await fetchSearch(siteRow, periodStart, periodEnd) : NO_ENRICHMENT;
  const gaUsers = gaResult.value;
  const search = searchResult.value;
  const softFailures: SoftFailure[] = [
    ...(gaResult.softFailed ? (["ga"] as const) : []),
    ...(searchResult.softFailed ? (["search"] as const) : []),
  ];

  const cidName = `${slug}-header`;
  const { html } = await renderReportHtml({
    siteName: siteRow.name,
    siteUrl: siteRow.url,
    reportType,
    completedOn,
    lighthouse: scores,
    gaUsersCurrent: gaUsers?.current,
    gaUsersPrevious: gaUsers?.previous,
    searchPosition: search?.foundOnPage1 ? (search.position ?? undefined) : undefined,
    lastTestedDate,
    commentary: null,
    copy: resolveCopy(siteRow),
    headerImageCid: cidName,
  });

  if (options.previewOnly) {
    const path = options.previewPath ?? `reports/${slug}/draft.html`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html, "utf-8");
    return { reportRow: null, htmlPath: path, html, softFailures, queued: null, supersededIds: [] };
  }

  if (base === null) throw new Error("base required when previewOnly=false");

  // "Finish an existing row" path (the --due re-draft wedge fix). When the caller
  // hands us a row that was created but never made Draft-ready — a crash between
  // createDraft and setDraftReady leaves exactly this — we DON'T createDraft again
  // (that would duplicate the period). We re-attach the rendered HTML and queue the
  // EXISTING row, completing the half-made draft in place. The row's other fields
  // (scores, period, dates) were already written at create time; the only pieces a
  // crash drops are the attachment + the ready flag.
  if (options.completeRowId) {
    await uploadDraftHtml(options.completeRowId, slug, periodEnd, html);
    const outcome = await queueDraft(base, {
      id: options.completeRowId,
      siteId: siteRow.id,
      reportType,
    });
    return {
      reportRow: options.existingRow ?? null,
      htmlPath: null,
      html,
      softFailures,
      queued: outcome.queued,
      supersededIds: outcome.supersededIds,
    };
  }

  const reportId = `${siteRow.name} — ${reportType} — ${periodEnd.toISOString().slice(0, 10)}`;
  const created = await createDraft(base, {
    reportId,
    siteId: siteRow.id,
    reportType,
    period: options.period ?? periodEnd.toISOString().slice(0, 7),
    periodStart,
    periodEnd,
    completedOn,
    lighthouse: scores,
    lastTestedDate,
    ...(gaUsers ? { gaUsersCurrent: gaUsers.current, gaUsersPrevious: gaUsers.previous } : {}),
    ...(search ? { searchFoundPage1: search.foundOnPage1 } : {}),
    ...(search?.foundOnPage1 && search.position !== null
      ? { searchPosition: search.position }
      : {}),
  });

  await uploadDraftHtml(created.id, slug, periodEnd, html);
  const outcome = await queueDraft(base, {
    id: created.id,
    siteId: siteRow.id,
    reportType,
  });

  return {
    reportRow: created,
    htmlPath: null,
    html,
    softFailures,
    queued: outcome.queued,
    supersededIds: outcome.supersededIds,
  };
}

/** Attach the rendered HTML to a Reports row. Queueing (Draft ready + the single-queue
 *  reconciliation) is handled separately by queueDraft so both the create path and the
 *  "complete a half-made row" path share the identical, re-runnable upload step. */
async function uploadDraftHtml(
  rowId: string,
  slug: string,
  periodEnd: Date,
  html: string,
): Promise<void> {
  const htmlFilename = `${slug}-${periodEnd.toISOString().slice(0, 10)}.html`;
  await uploadAttachment(rowId, "Rendered HTML", html, htmlFilename, "text/html");
}

/** Result of an enrichment fetch: the value (null if unavailable) plus whether
 *  it errored (`softFailed`) as opposed to being legitimately not-configured. */
type Enrichment<T> = { value: T | null; softFailed: boolean };
/** A not-configured / skipped enrichment — null value, not a soft-failure. */
const NO_ENRICHMENT: Enrichment<never> = { value: null, softFailed: false };

/**
 * Fetch GA "Users" for the period, soft-failing to null. Returns a null value (no enrichment)
 * when GA isn't configured (`GA_SUBJECT` unset) or the site has no GA4 property ID — those are
 * legitimate skips, `softFailed: false`. When the GA API errors it logs a one-line warning and
 * returns `softFailed: true`. Never throws, so a GA problem can never block a draft; the
 * operator can always enter the numbers by hand.
 */
export async function fetchGaUsers(
  siteRow: WebsiteRow,
  periodStart: Date,
  periodEnd: Date,
): Promise<Enrichment<{ current: number; previous: number }>> {
  const cfg = readGaConfig();
  if (!cfg || !siteRow.ga4PropertyId) return NO_ENRICHMENT;
  try {
    const value = await fetchPeriodUsers(
      { propertyId: siteRow.ga4PropertyId, subject: cfg.subject, keyPath: cfg.keyPath },
      periodStart,
      periodEnd,
    );
    return { value, softFailed: false };
  } catch (e) {
    console.warn(`⚠ GA skipped for ${siteRow.name}: ${(e as Error).message}`);
    return { value: null, softFailed: true };
  }
}

/**
 * Fetch the site's Google search presence for the period, soft-failing to null. Returns a null
 * value when GA/SA isn't configured (`readGaConfig()` null — search shares the SA credentials)
 * or the site has no `searchQuery` (legitimate skips, `softFailed: false`). When the Search
 * Console API errors it logs a one-line warning and returns `softFailed: true`. Never throws,
 * so a search problem can never block a draft.
 */
export async function fetchSearch(
  siteRow: WebsiteRow,
  periodStart: Date,
  periodEnd: Date,
): Promise<Enrichment<SearchPresence>> {
  const cfg = readGaConfig();
  if (!cfg || !siteRow.searchQuery) return NO_ENRICHMENT;
  try {
    const value = await fetchSearchPresence(
      {
        keyPath: cfg.keyPath,
        subject: cfg.subject,
        property: siteRow.searchConsoleProperty ?? undefined,
        host: siteRow.url,
        query: siteRow.searchQuery,
      },
      periodStart,
      periodEnd,
    );
    return { value, softFailed: false };
  } catch (e) {
    console.warn(`⚠ Search presence skipped for ${siteRow.name}: ${(e as Error).message}`);
    return { value: null, softFailed: true };
  }
}

async function derivePeriodStart(
  base: AirtableBase,
  siteRow: WebsiteRow,
  reportType: ReportType,
  today: Date,
): Promise<Date> {
  const prior = await listReportsForSite(base, siteRow.id);
  const sameType = prior
    .filter((r) => r.reportType === reportType && r.periodEnd)
    .map((r) => r.periodEnd!)
    .sort();
  const latest = sameType[sameType.length - 1];
  if (!latest) return daysAgo(today, 30);
  // Half-open periods. The prior report's GA/Search windows are inclusive of its
  // periodEnd, so starting this report on the *same* day double-counts that
  // boundary day across two consecutive reports (and inflates the headline Users
  // count). Start the next day instead. UTC to stay TZ-consistent with daysAgo.
  const start = new Date(latest);
  start.setUTCDate(start.getUTCDate() + 1);
  return start;
}
