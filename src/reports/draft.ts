import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReportType, LighthouseScores } from "./types.js";
import { renderReportHtml } from "./render.js";
import { siteSlug } from "./airtable/websites.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import { createDraft, setDraftReady, listReportsForSite } from "./airtable/reports.js";
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
  const lastTestedDate =
    reportType === "Maintenance" && siteRow.testingDay ? new Date(siteRow.testingDay) : null;

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
    headerImageCid: cidName,
  });

  if (options.previewOnly) {
    const path = options.previewPath ?? `reports/${slug}/draft.html`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html, "utf-8");
    return { reportRow: null, htmlPath: path, html, softFailures };
  }

  if (base === null) throw new Error("base required when previewOnly=false");

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

  const htmlFilename = `${slug}-${periodEnd.toISOString().slice(0, 10)}.html`;
  await uploadAttachment(created.id, "Rendered HTML", html, htmlFilename, "text/html");
  await setDraftReady(base, created.id, true);

  return { reportRow: created, htmlPath: null, html, softFailures };
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
async function fetchGaUsers(
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
async function fetchSearch(
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
