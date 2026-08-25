import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReportType, LighthouseScores } from "./types.js";
import { renderReportHtml } from "./render.js";
import { siteSlug, updateAnalyticsHealth } from "./airtable/websites.js";
import { resolveCopy } from "./copy.js";
import type { WebsiteRow } from "./airtable/websites.js";
import type { ReportRow } from "./airtable/reports.js";
import { createDraft, listReportsForSite } from "./airtable/reports.js";
import type { ReportMirror } from "./report-mirror.js";
import { queueDraft } from "./queue.js";
import { autoTickChecklist } from "./auto-tick.js";
import { uploadAttachment } from "./airtable/attachments.js";
import type { AirtableBase } from "./airtable/client.js";
import { readGaConfig } from "./ga/config.js";
import { fetchPeriodUsers } from "./ga/client.js";
import { fetchSearchPresence } from "./search/client.js";
import type { SearchPresence } from "./search/client.js";
import { generateHeaderImage } from "./header-image/index.js";
import type { GeneratedHeaderImage } from "./header-image/index.js";

export type RefreshHeaderDeps = {
  generate?: (input: { url: string; slug?: string }) => Promise<GeneratedHeaderImage>;
  upload?: (
    recordId: string,
    field: string,
    bytes: Uint8Array,
    filename: string,
    contentType: string,
    opts?: { replaceIn?: string },
  ) => Promise<void>;
};

/**
 * Regenerate a site's Header image from its live homepage so the report ships a
 * current screenshot rather than one frozen whenever the image was last made by
 * hand. Sonder alone runs 16 reports a year, so a static header goes visibly
 * stale.
 *
 * BEST-EFFORT BY DESIGN — returns false and never throws. A capture or upload
 * failure must not fail the draft: the stored image is still perfectly usable,
 * and the operator reviews the rendered preview before approving the send.
 */
export async function refreshHeaderImage(
  site: WebsiteRow,
  deps: RefreshHeaderDeps = {},
): Promise<boolean> {
  if (!site.url) return false;
  const generate = deps.generate ?? generateHeaderImage;
  const upload = deps.upload ?? uploadAttachment;
  try {
    const gen = await generate({ url: site.url, slug: siteSlug(site.name) });
    await upload(site.id, "Header image", gen.bytes, gen.filename, gen.contentType, {
      replaceIn: "Websites",
    });
    return true;
  } catch (err) {
    console.warn(
      `⚠ header-image refresh skipped for ${site.name}: ${
        err instanceof Error ? err.message : String(err)
      } — keeping the stored image`,
    );
    return false;
  }
}

export type DraftOptions = {
  /** Where to write the local preview HTML when `previewOnly`. Defaults to `reports/<slug>/draft.html`. */
  previewPath?: string;
  /** If true: render locally only, never touch Airtable. */
  previewOnly?: boolean;
  /** Whether to run the GA / Search Console enrichment fetches. Defaults to
   *  `base !== null`, i.e. the real drafting path enriches and a preview does not.
   *
   *  This exists because `base === null` was carrying two unrelated meanings —
   *  "never write to Airtable" AND "perform no IO at all" — and only the first is
   *  what `previewOnly` actually asks for. Enrichment reads Google; it writes
   *  nothing, so there is no reason a preview cannot do it on request. Conflating
   *  the two made the preview path structurally incapable of ever producing an
   *  ANALYTICS section, which in turn made a CI job built to prove the GA secrets
   *  fail 100% of the time and report it as a credential outage (2026-08-12). Set
   *  this true to render a preview that exercises the credentials for real. */
  enrich?: boolean;
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
  /** Injected deps for the draft-time header refresh, or `false` to skip it
   *  entirely. Tests set `false` (or a stub) so a unit suite never launches a
   *  browser or resolves DNS. Production leaves it unset and gets the real thing. */
  refreshHeader?: RefreshHeaderDeps | false;
  /** #539 Phase 5: Turso write-through for everything this function writes to
   *  Airtable — the created row, the rendered body, and the queue flag — so a
   *  fresh draft is fully readable in the Turso-backed console immediately
   *  instead of after the next hourly sync.
   *
   *  Deliberately NOT defaulted here. Defaulting would open a real libSQL handle
   *  from inside `draftReportForSite`, which every unit test calls — and on a
   *  machine with TURSO_* exported that means a test suite writing rows into
   *  production. The wiring lives at the composition roots (cli/commands/report.ts,
   *  recipes) where it is pinned by test, the same division `runFleetWriteBack`
   *  uses for the health mirror. */
  reportMirror?: ReportMirror;
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
  /** True when search enrichment fell back to the site name (no explicit `Search query`)
   *  AND that default matched nothing in Search Console — the signal that this site needs
   *  a hand-tuned brand query. Distinct from a soft-failure/outage: the fetch succeeded, it
   *  just found no data for the name. Requires a property to have RESOLVED — a site with no
   *  Search Console property at all raises `searchPropertyMissing` instead (a query change
   *  can't fix that, and prescribing one would silence the real problem). */
  searchDefaultMissed: boolean;
  /** True when NO Search Console property matched the site for any subject — a
   *  missing/unverified property or lost service-account access. Fires for BOTH explicit
   *  and name-default queries (unlike `searchDefaultMissed`), because no query can succeed
   *  without a property. Distinct from a soft-failure: the API worked, the property list
   *  just contained nothing for this site. */
  searchPropertyMissing: boolean;
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

  // GA enrichment. Soft-fail: any GA problem leaves the numbers null so
  // the draft still proceeds (operator fills them manually) — GA is an enhancement, not a
  // gate. Rendered with the fetched numbers so the review HTML matches the Airtable fields.
  // An *error* (vs a legitimate not-configured skip) is recorded in softFailures so the
  // caller can surface a fleet-wide outage in the batch summary.
  // Enrichment is gated on `enrich`, NOT on `base`: reading Google and writing to
  // Airtable are independent, and only the write is what previewOnly forbids.
  const shouldEnrich = options.enrich ?? base !== null;
  const gaResult = shouldEnrich
    ? await fetchGaUsers(siteRow, periodStart, periodEnd)
    : NO_ENRICHMENT;
  const searchResult = shouldEnrich
    ? await fetchSearch(siteRow, periodStart, periodEnd)
    : // No-IO render path: nothing was attempted, so this is not an environment gap
      // (`notConfigured` would wrongly tell the operator to go wire a secret).
      {
        ...NO_ENRICHMENT,
        defaultQueryMissed: false,
        propertyMissing: false,
        notConfigured: false,
      };
  const gaUsers = gaResult.value;
  const search = searchResult.value;
  const softFailures: SoftFailure[] = [
    ...(gaResult.softFailed ? (["ga"] as const) : []),
    ...(searchResult.softFailed ? (["search"] as const) : []),
  ];

  // Header-image refresh (real path only). Regenerated BEFORE the render so the
  // preview the operator approves carries the same screenshot the client will
  // receive — the send reads this attachment off the Websites row. Gated on
  // `base !== null` exactly like the GA/Search enrichment above: the no-IO render
  // path (base === null, used for pure rendering and tests) must not launch a
  // browser or write to production Airtable. `refreshHeader: false` is the second
  // gate, for suites that DO pass a fake base and would otherwise pay a real
  // chromium launch per case. Production leaves it unset and gets the real
  // refresh. Best-effort — see refreshHeaderImage.
  if (base !== null && options.refreshHeader !== false) {
    await refreshHeaderImage(siteRow, options.refreshHeader ?? {});
  }

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
    return {
      reportRow: null,
      htmlPath: path,
      html,
      softFailures,
      searchDefaultMissed: searchResult.defaultQueryMissed,
      searchPropertyMissing: searchResult.propertyMissing,
      queued: null,
      supersededIds: [],
    };
  }

  if (base === null) throw new Error("base required when previewOnly=false");

  // Record this site's GA/Search enrichment health for the per-site analytics-failure
  // signal (cockpit/digest). Only when analytics is configured for THIS site — set the
  // timestamp on a soft-fail, clear it (null) on a clean enrichment so the signal
  // self-heals. Best-effort: the `Analytics soft-fail at` column is operator-added, so
  // until it exists the write throws UNKNOWN_FIELD_NAME — which must NOT break drafting.
  if (readGaConfig() !== null && Boolean(siteRow.ga4PropertyId || siteRow.searchQuery)) {
    try {
      await updateAnalyticsHealth(
        base,
        siteRow.id,
        softFailures.length > 0 ? today.toISOString() : null,
      );
    } catch (e) {
      console.warn(`⚠ analytics-health write skipped for ${siteRow.name}: ${(e as Error).message}`);
    }
  }

  // "Finish an existing row" path (the --due re-draft wedge fix). When the caller
  // hands us a row that was created but never made Draft-ready — a crash between
  // createDraft and setDraftReady leaves exactly this — we DON'T createDraft again
  // (that would duplicate the period). We re-attach the rendered HTML and queue the
  // EXISTING row, completing the half-made draft in place. The row's other fields
  // (scores, period, dates) were already written at create time; the only pieces a
  // crash drops are the attachment + the ready flag.
  if (options.completeRowId) {
    await uploadDraftHtml(options.completeRowId, slug, periodEnd, html, options.reportMirror);
    const outcome = await queueDraft(
      base,
      { id: options.completeRowId, siteId: siteRow.id, reportType },
      options.reportMirror,
    );
    return {
      reportRow: options.existingRow ?? null,
      htmlPath: null,
      html,
      softFailures,
      searchDefaultMissed: searchResult.defaultQueryMissed,
      searchPropertyMissing: searchResult.propertyMissing,
      queued: outcome.queued,
      supersededIds: outcome.supersededIds,
    };
  }

  // Auto-tick the checklist boxes the system can prove (Phase 1: Google Indexed via the
  // inline search signal). Fail-safe lives in autoTickChecklist: only `pass` entries are ticked;
  // the evidence snapshot drives the dashboard's green/amber badges. The operator's approve gate
  // and per-box override are unchanged.
  const evidence = autoTickChecklist(siteRow, reportType, completedOn, { search: searchResult });
  const checklistTicks = [...evidence.entries()]
    .filter(([, e]) => e.result === "pass")
    .map(([field]) => field);
  const autoEvidence = Object.fromEntries(evidence);

  const reportId = `${siteRow.name} — ${reportType} — ${periodEnd.toISOString().slice(0, 10)}`;
  const created = await createDraft(
    base,
    {
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
      checklistTicks,
      autoEvidence,
    },
    options.reportMirror?.created,
  );

  await uploadDraftHtml(created.id, slug, periodEnd, html, options.reportMirror);
  const outcome = await queueDraft(
    base,
    { id: created.id, siteId: siteRow.id, reportType },
    options.reportMirror,
  );

  return {
    reportRow: created,
    htmlPath: null,
    html,
    softFailures,
    searchDefaultMissed: searchResult.defaultQueryMissed,
    searchPropertyMissing: searchResult.propertyMissing,
    queued: outcome.queued,
    supersededIds: outcome.supersededIds,
  };
}

/** Attach the rendered HTML to a Reports row. Queueing (Draft ready + the single-queue
 *  reconciliation) is handled separately by queueDraft so both the create path and the
 *  "complete a half-made row" path share the identical, re-runnable upload step.
 *
 *  #539 Phase 5: the body is ALSO stored in Turso, because that is where the
 *  console's preview route reads it. Storing the row without the body leaves a
 *  visible draft whose preview answers "No rendered body stored" until the next
 *  hourly sync re-downloads this very attachment. */
async function uploadDraftHtml(
  rowId: string,
  slug: string,
  periodEnd: Date,
  html: string,
  mirror?: ReportMirror,
): Promise<void> {
  const htmlFilename = `${slug}-${periodEnd.toISOString().slice(0, 10)}.html`;
  await uploadAttachment(rowId, "Rendered HTML", html, htmlFilename, "text/html");
  await mirror?.body(rowId, html);
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
      { propertyId: siteRow.ga4PropertyId, subjects: cfg.subjects, keyPath: cfg.keyPath },
      periodStart,
      periodEnd,
    );
    return { value, softFailed: false };
  } catch (e) {
    console.warn(`⚠ GA skipped for ${siteRow.name}: ${(e as Error).message}`);
    return { value: null, softFailed: true };
  }
}

/** A search enrichment, plus the two distinct miss flags (see `fetchSearch` /
 *  `DraftResult.searchDefaultMissed` / `DraftResult.searchPropertyMissing`) and the
 *  environment-gap flag `notConfigured`. */
type SearchEnrichment = Enrichment<SearchPresence> & {
  defaultQueryMissed: boolean;
  propertyMissing: boolean;
  /** True when the site IS analytics-enrolled but this environment has no GA/SC
   *  credentials (`GA_SUBJECT` unset) — so the check could not run at all. Distinct
   *  from the un-enrolled skip (nothing to measure) and from a soft-fail (the API
   *  errored). See {@link fetchSearch}. */
  notConfigured: boolean;
};

/**
 * Fetch the site's Google search presence for the period, soft-failing to null. Runs whenever
 * GA/SA is configured (`readGaConfig()` non-null — search shares the SA credentials) AND the
 * site is analytics-enrolled (has a `ga4PropertyId` OR an explicit `searchQuery`); otherwise a
 * legitimate skip (null value, `softFailed: false`). The brand query defaults to the site NAME
 * when no explicit `searchQuery` is set (whitespace-only counts as unset) — so brand presence is
 * tracked automatically, and the operator only hand-tunes the handful of sites the name misses.
 *
 * `propertyMissing` is true when NO Search Console property matched the site for any subject
 * (missing/unverified property or lost SA access) — flagged for BOTH explicit and name-default
 * queries, because no query can fix a missing property. Pre-split, this case was folded into
 * `defaultQueryMissed`, whose "set an explicit Search query" remedy would permanently SILENCE
 * it (an explicit query that finds nothing is by design never flagged).
 *
 * `defaultQueryMissed` is true ONLY when a property resolved, the site-name default was used,
 * AND Search Console returned no data for it (`position === null`) — the signal to set an
 * explicit `Search query`. It is false for an explicit query (even one that finds nothing —
 * that's a valid measurement), a default that does find a position, the not-enrolled skip,
 * and the errored soft-fail path.
 *
 * `notConfigured` splits the old single skip in two. An un-enrolled site is a true skip —
 * there is nothing to measure, and the checklist row stays manual. But an ENROLLED site in an
 * environment with no credentials is an environment gap: the check was supposed to run and
 * couldn't. Collapsing the two made a credential-less run (exactly what the daily-reports
 * workflow was) indistinguishable from "this site opted out", so the Google Indexed row
 * silently vanished from every drafted report instead of saying why.
 *
 * When the Search Console API errors it logs a one-line warning and returns `softFailed: true`.
 * Never throws, so a search problem can never block a draft.
 */
export async function fetchSearch(
  siteRow: WebsiteRow,
  periodStart: Date,
  periodEnd: Date,
): Promise<SearchEnrichment> {
  const cfg = readGaConfig();
  const enrolled = Boolean(siteRow.ga4PropertyId || siteRow.searchQuery);
  if (!cfg || !enrolled) {
    const notConfigured = enrolled && !cfg;
    if (notConfigured) {
      console.warn(
        `⚑ Search: no GA/Search Console credentials in this environment (GA_SUBJECT unset) — the Google Indexed check could not run for ${siteRow.name}.`,
      );
    }
    return { ...NO_ENRICHMENT, defaultQueryMissed: false, propertyMissing: false, notConfigured };
  }
  const explicit = siteRow.searchQuery?.trim();
  const query = explicit || siteRow.name;
  const usedDefault = !explicit;
  try {
    const value = await fetchSearchPresence(
      {
        keyPath: cfg.keyPath,
        subjects: cfg.subjects,
        property: siteRow.searchConsoleProperty ?? undefined,
        host: siteRow.url,
        query,
      },
      periodStart,
      periodEnd,
    );
    const propertyMissing = !value.propertyFound;
    if (propertyMissing) {
      console.warn(
        `⚑ Search: no Search Console property matched ${siteRow.url} for ${siteRow.name} — verify the domain property exists and the service account has access. (A "Search query" change cannot fix this.)`,
      );
    }
    const defaultQueryMissed = value.propertyFound && usedDefault && value.position === null;
    if (defaultQueryMissed) {
      console.warn(
        `⚑ Search: site-name default "${query}" found no Search Console data for ${siteRow.name} — set an explicit "Search query" in Airtable to track brand presence.`,
      );
    }
    return { value, softFailed: false, defaultQueryMissed, propertyMissing, notConfigured: false };
  } catch (e) {
    console.warn(`⚠ Search presence skipped for ${siteRow.name}: ${(e as Error).message}`);
    return {
      value: null,
      softFailed: true,
      defaultQueryMissed: false,
      propertyMissing: false,
      notConfigured: false,
    };
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
