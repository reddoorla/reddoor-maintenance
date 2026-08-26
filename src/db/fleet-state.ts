/** Phase 2 of the Airtable → Turso migration (#539): the fleet-state READ layer.
 *
 *  Returns the exact `WebsiteRow` shape the Airtable module returns, so every
 *  repoint is an import-only swap at a composition root — the same trick
 *  listSubmissionsForSite used for the hybrid-db cutover. The raw values live
 *  in `sites`/`site_health`/`site_schedule` (written by the importer / hourly
 *  sync); coercion to `WebsiteRow` happens HERE, reusing the Airtable module's
 *  own exported coercers (`toVerdict`, `toFrequency`, `parseNotifyRouting`,
 *  `parseSecurityAdvisories`, `trimToNull`) so there is one truth for each.
 *
 *  The equivalence instrument (tests/db/fleet-state.test.ts) pins this module
 *  to `mapRow` field-by-field: for a fixture record, `mapRow(rec)` must deep-
 *  equal the row read back through here after an import. A new WebsiteRow
 *  field fails that test until this module carries it.
 *
 *  `headerImage` is the ONE deliberate exception (design D5): Airtable stopped
 *  being its source — the bytes belong in `sites.header_image*`. Those columns
 *  ARE now written: the header-image CLI dual-writes on every generation and the
 *  one-shot backfill copied the rest, so as of 2026-08-25 production carries a
 *  BLOB for 12 of the 13 maintained sites (the 13th, LA Homelessness Youth, has
 *  no header image in Airtable either — its reports are blocked at approve for
 *  exactly that). An earlier version of this comment said the columns were empty
 *  fleet-wide; that was true when written and is no longer.
 *
 *  The `url` is "" because the bytes live in the row itself, not behind a signed
 *  URL — which is why `url` is NOT a usable handle. A consumer that needs the
 *  image calls `loadHeaderImage(db, siteId)` for the bytes; the send path still
 *  fetches the Airtable attachment, and moving it over is its own change.
 */
import type { Selectable, Updateable } from "kysely";
import type { Db } from "./client.js";
import type { ReportsTable, SiteHealthTable, SiteScheduleTable, SitesTable } from "./schema.js";
import {
  SITE_FIELDS,
  siteValueFor,
  healthColumnFor,
  scheduleColumnFor,
  mapReportRecord,
  mapWebsiteRecord,
  type RawRecord,
} from "./import-airtable.js";
import type { AirtableCellValue } from "../reports/airtable/websites.js";
import {
  toReportType,
  parseAutoEvidence,
  type ReportRow,
  type DeliveryStatus,
} from "../reports/airtable/reports.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../reports/checklist.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { canonicalizeStatus } from "../reports/airtable/site-status.js";
import {
  parseNotifyRouting,
  parseSecurityAdvisories,
  toFrequency,
  toPrismicModelsVerdict,
  toVerdict,
  trimToNull,
} from "../reports/airtable/websites.js";

type JoinedRow = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
/** Stored 1/0/null (importer's b01n) → boolean | null. */
const bool = (v: unknown): boolean | null => (typeof v === "number" ? v !== 0 : null);

/** Stored JSON array (importer-normalized) → the trimmed string[] mapRow yields. */
function parseAwc(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function rowFromJoined(r: JoinedRow): WebsiteRow {
  const name = String(r.name ?? "");
  const headerFilename = str(r.header_image_filename);
  const headerType = str(r.header_image_type);
  return {
    id: String(r.id),
    name,
    url: str(r.url) ?? "",
    // `sites.status` holds the RAW Airtable cell (the importer stores it verbatim
    // so the hourly parity check compares raw-to-raw). Canonicalizing HERE — the
    // twin of mapRow's seam — is what keeps the #558 equivalence instrument green.
    status: canonicalizeStatus(r.status),
    statusRaw: str(r.status),
    pointOfContact: str(r.point_of_contact),
    maintenanceFreq: toFrequency(r.maintenance_freq, `${name} maintenance`),
    testingFreq: toFrequency(r.testing_freq, `${name} testing`),
    maintenanceFreqRaw: str(r.maintenance_freq),
    testingFreqRaw: str(r.testing_freq),
    maintenanceDay: str(r.maintenance_day),
    testingDay: str(r.testing_day),
    ga4PropertyId: str(r.ga4_property_id),
    searchQuery: str(r.search_query),
    searchConsoleProperty: str(r.search_console_property),
    analyticsSoftFailAt: str(r.analytics_soft_fail_at),
    gitRepo: str(r.git_repo),
    reportRecipientsTo: str(r.report_recipients_to),
    reportRecipientsCc: str(r.report_recipients_cc),
    acceptedWatchConditions: parseAwc(r.accepted_watch_conditions),
    headerImage:
      headerFilename !== null && headerType !== null
        ? { url: "", filename: headerFilename, type: headerType }
        : null,
    pScore: num(r.p_score),
    rScore: num(r.r_score),
    bpScore: num(r.bp_score),
    seoScore: num(r.seo_score),
    lastLighthouseAuditAt: str(r.lighthouse_at),
    a11yViolations: num(r.a11y_violations),
    depsDrifted: num(r.deps_drifted),
    depsMajorBehind: num(r.deps_major_behind),
    depsOutdated: num(r.deps_outdated),
    depsMajorOutdated: num(r.deps_major_outdated),
    securityVulnsCritical: num(r.vulns_critical),
    securityVulnsHigh: num(r.vulns_high),
    securityVulnsModerate: num(r.vulns_moderate),
    securityVulnsLow: num(r.vulns_low),
    securityAutoFixAttempts: num(r.auto_fix_attempts),
    lastSecurityAuditAt: str(r.security_audit_at),
    securityAdvisories: parseSecurityAdvisories(r.security_advisories),
    certDaysRemaining: num(r.cert_days_remaining),
    domainCheckedAt: str(r.domain_checked_at),
    netlifyId: trimToNull(r.netlify_id),
    deployStatus: str(r.deploy_status),
    lastDeployAt: str(r.last_deploy_at),
    deployLogUrl: str(r.deploy_log_url),
    deployCheckedAt: str(r.deploy_checked_at),
    functionHealth: toVerdict(r.function_health),
    cmsReachable: toVerdict(r.cms_reachable),
    turnstileWidget: toVerdict(r.turnstile_widget),
    functionHealthCheckedAt: str(r.function_health_checked_at),
    crossbrowserOk: bool(r.crossbrowser_ok),
    mobileOk: bool(r.mobile_ok),
    linksOk: bool(r.links_ok),
    brokenLinks: num(r.broken_links),
    browserCheckedAt: str(r.browser_checked_at),
    reachableOk: toVerdict(r.uptime_reachable),
    titleMetaOk: toVerdict(r.titles_meta_ok),
    copyIntro: trimToNull(r.copy_intro),
    copyContact: trimToNull(r.copy_contact),
    copyFooter: trimToNull(r.copy_footer),
    launchedAt: str(r.launched_at),
    newsletterWebhook: trimToNull(r.newsletter_webhook),
    notifyRouting: parseNotifyRouting(r.notify_routing),
    notifyRoutingRaw: trimToNull(r.notify_routing),
    mailchimpApiKey: trimToNull(r.mailchimp_api_key),
    mailchimpAudienceId: trimToNull(r.mailchimp_audience_id),
    requireTurnstile: typeof r.require_turnstile === "number" ? r.require_turnstile !== 0 : false,
    renovateFailingCis: num(r.renovate_failing_cis),
    defaultBranchCi: str(r.default_branch_ci),
    lastCommitAt: str(r.last_commit_at),
    githubSignalsAt: str(r.github_signals_at),
    smokeOk: toVerdict(r.smoke_ok),
    lastSmokeAt: str(r.last_smoke_at),
    formE2eOk: toVerdict(r.form_e2e_ok),
    formE2eCheckedAt: str(r.form_e2e_checked_at),
    prismicModels: toPrismicModelsVerdict(r.prismic_models),
    prismicModelsCheckedAt: str(r.prismic_models_checked_at),
    prismicModelsDrift: str(r.prismic_models_drift),
    prismicAckUntil: str(r.prismic_ack_until),
    nextMaintenanceAt: str(r.next_maintenance_at),
    nextTestingAt: str(r.next_testing_at),
  };
}

/** Every sites column EXCEPT the header-image BLOB. Since the 2026-08-24
 *  backfill, header_image holds 0.7–3.5 MB JPEGs — a selectAll would haul
 *  megabytes into every site lookup (per LEAD on the ingest path, ×44 on the
 *  fleet list) and Turso bills the bytes. WebsiteRow only needs the metadata
 *  columns; the bytes have their own dedicated readers when a consumer wants
 *  them. Kept in lockstep with SitesTable by the blob-exclusion test. */
const SITE_COLUMNS = [
  "sites.id",
  "sites.slug",
  "sites.name",
  "sites.url",
  "sites.status",
  "sites.point_of_contact",
  "sites.maintenance_freq",
  "sites.testing_freq",
  "sites.maintenance_day",
  "sites.testing_day",
  "sites.ga4_property_id",
  "sites.search_query",
  "sites.search_console_property",
  "sites.git_repo",
  "sites.netlify_id",
  "sites.report_recipients_to",
  "sites.report_recipients_cc",
  "sites.copy_intro",
  "sites.copy_contact",
  "sites.copy_footer",
  "sites.newsletter_webhook",
  "sites.mailchimp_api_key",
  "sites.mailchimp_audience_id",
  "sites.notify_routing",
  "sites.require_turnstile",
  "sites.accepted_watch_conditions",
  "sites.prismic_ack_until",
  "sites.launched_at",
  "sites.header_image_filename",
  "sites.header_image_type",
  "sites.header_image_generated_at",
  "sites.legacy",
] as const;

/** The three-table join every read composes from. site_health/site_schedule
 *  rows are upserted alongside sites by the importer, but LEFT JOIN anyway —
 *  a site row must never vanish from a surface because a health row is absent. */
function joined(db: Db) {
  return db
    .selectFrom("sites")
    .leftJoin("site_health", "site_health.site_id", "sites.id")
    .leftJoin("site_schedule", "site_schedule.site_id", "sites.id")
    .select(SITE_COLUMNS)
    .selectAll(["site_health", "site_schedule"]);
}

/** Write-through for the site-detail editor (Phase 2): after the Airtable
 *  write (still the Phase 2 source of truth), mirror the same cell into
 *  `sites` so a Turso-reading page renders the edit immediately instead of
 *  waiting for the next hourly sync. The column mapping is the IMPORTER's own
 *  map — one truth — and the value gets the importer's empty-clears-to-null
 *  semantics. Throws on a column the importer doesn't claim (the lockstep
 *  test makes that unreachable for the editor's allowlist); the caller treats
 *  a mirror failure as non-fatal — the hourly sync converges it.
 *
 *  Handles the non-text columns too (`Require Turnstile` is a checkbox,
 *  `Accepted Watch Conditions` a multi-select): the coercion is NOT repeated
 *  here, it is delegated to the importer's own `siteValueFor`. That delegation
 *  is the whole safety property — parity compares raw-to-raw, so a mirror that
 *  stored `"true"` where the importer stores `1` would red every hourly run. */
export async function mirrorSiteField(
  db: Db,
  siteId: string,
  airtableColumn: string,
  value: AirtableCellValue,
): Promise<void> {
  await mirrorSiteFields(db, siteId, { [airtableColumn]: value });
}

/** The multi-column form, and where the work actually happens (#539 Phase 5).
 *
 *  `updateLaunched` is why it exists: it flips `Status` AND stamps `Launched at`
 *  in one Airtable update, and mirroring those as two separate UPDATEs would
 *  open a window where Turso says a site is maintained but never launched.
 *
 *  Same contract as {@link mirrorHealthFields}, deliberately — it takes the
 *  EXACT FieldSet just written to Airtable (the writers return it, so the mirror
 *  cannot carry a different payload), and returns whether a `sites` row matched:
 *  a site the hourly sync hasn't imported yet updates 0 rows → false, so the
 *  caller can count it honestly instead of claiming it mirrored. An empty
 *  FieldSet runs no SQL and returns true — nothing to mirror is not a miss. */
export async function mirrorSiteFields(
  db: Db,
  siteId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const patch: Record<string, string | number | null> = {};
  for (const [airtableColumn, value] of Object.entries(fields)) {
    const col = SITE_FIELDS[airtableColumn];
    if (!col)
      throw new Error(`mirrorSiteFields: importer claims no sites column for '${airtableColumn}'`);
    // Empty text still clears to null (the importer's `s()` does the same); the
    // non-text columns get their own coercion inside siteValueFor.
    patch[col] = siteValueFor(col, value);
  }
  if (Object.keys(patch).length === 0) return true;
  const res = await db
    .updateTable("sites")
    .set(patch as Updateable<SitesTable>)
    .where("id", "=", siteId)
    .executeTakeFirst();
  // kysely/libSQL reports numUpdatedRows as a BigInt — compare in BigInt.
  return res.numUpdatedRows > 0n;
}

/** Mirror a NEWLY CREATED Airtable Websites record into Turso (#539 Phase 5).
 *
 *  `ensure-site` CREATES a row, and every other site mirror is an UPDATE, which
 *  does nothing at all for a row that does not exist yet — so a site
 *  bootstrapped at 09:05 was invisible until the 09:20 sync, and every mirror
 *  the rest of the bootstrap fired reported `mirrored=missed` with nothing to
 *  update.
 *
 *  Maps with the IMPORTER's own `mapWebsiteRecord`, which is also exactly what
 *  parity diffs against: that delegation is what makes the mirrored rows
 *  parity-clean by construction rather than by a column list someone has to
 *  remember to extend.
 *
 *  All THREE rows, not just `sites`. Parity reverse-checks `site_health` and
 *  `site_schedule` per site and reports a missing one as `(row) ABSENT`, and a
 *  later `mirrorHealthFields` would return `missed` forever with no row to hit.
 *
 *  Upserts rather than inserts because `ensure-site` is re-run to RESUME a
 *  bootstrap. The header_image* columns survive that by construction —
 *  `mapWebsiteRecord` does not carry them (Airtable stopped being their source,
 *  design D5), so the conflict branch cannot blank a stored plate whose bytes
 *  live in no other store. */
export async function mirrorSiteInsert(db: Db, rec: RawRecord, computedAt: string): Promise<void> {
  const { site, health, schedule } = mapWebsiteRecord(rec, computedAt);
  await db
    .insertInto("sites")
    .values(site)
    .onConflict((oc) => oc.column("id").doUpdateSet(site))
    .execute();
  await db
    .insertInto("site_health")
    .values(health)
    .onConflict((oc) => oc.column("site_id").doUpdateSet(health))
    .execute();
  await db
    .insertInto("site_schedule")
    .values(schedule)
    .onConflict((oc) => oc.column("site_id").doUpdateSet(schedule))
    .execute();
}

/** Write-through mirror for the nightly health writers (#539 Phase 3). Takes
 *  the EXACT FieldSet just written to Airtable (updateAuditFields /
 *  updateGitHubSignals return it), so the mirror can never carry a different
 *  payload than the Airtable write it shadows. Resolution + coercion come from
 *  the importer's healthColumnFor — one truth; an Airtable column no
 *  site_health column claims throws (same contract as mirrorSiteField).
 *  Partial by design: absent fields stay untouched, matching
 *  updateGitHubSignals' deliberate omission of a null lastCommitAt. Returns
 *  whether a site_health row matched: a site the hourly sync hasn't imported
 *  yet updates 0 rows → false, so the caller can count it honestly
 *  (mirror_missed) instead of claiming it mirrored — it still converges on the
 *  next sync, like every mirror. An empty FieldSet runs no SQL and returns
 *  true: nothing to mirror is not a miss. */
export async function mirrorHealthFields(
  db: Db,
  siteId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  // Per-column value types (number vs text) are guaranteed by healthColumnFor's
  // coercion — the numeric/text split lives there, once — so the patch builds
  // untyped and casts at the .set() boundary (the importer's own idiom).
  const patch: Record<string, string | number | null> = {};
  for (const [field, value] of Object.entries(fields)) {
    const m = healthColumnFor(field);
    if (!m)
      throw new Error(`mirrorHealthFields: importer claims no site_health column for '${field}'`);
    patch[m.col] = m.coerce(value);
  }
  if (Object.keys(patch).length === 0) return true;
  const res = await db
    .updateTable("site_health")
    .set(patch as Updateable<SiteHealthTable>)
    .where("site_id", "=", siteId)
    .executeTakeFirst();
  // kysely/libSQL reports numUpdatedRows as a BigInt — compare in BigInt.
  return res.numUpdatedRows > 0n;
}

/** The site_schedule twin of {@link mirrorHealthFields}, for the nightly
 *  next-due write-back. `computedAt` stamps when THIS computation ran — the
 *  hourly sync overwrites it with its own import stamp, same as every mirrored
 *  value. Empty fields → full no-op (no lone computed_at stamp for a write
 *  that carried nothing). Same return contract as mirrorHealthFields: false
 *  when the UPDATE matched no site_schedule row (site not yet imported), true
 *  otherwise — including the empty-fields no-op. */
export async function mirrorScheduleFields(
  db: Db,
  siteId: string,
  fields: Record<string, unknown>,
  computedAt: string,
): Promise<boolean> {
  const patch: Record<string, string | null> = {};
  for (const [field, value] of Object.entries(fields)) {
    const m = scheduleColumnFor(field);
    if (!m)
      throw new Error(
        `mirrorScheduleFields: importer claims no site_schedule column for '${field}'`,
      );
    patch[m.col] = m.coerce(value);
  }
  if (Object.keys(patch).length === 0) return true;
  patch.computed_at = computedAt;
  const res = await db
    .updateTable("site_schedule")
    .set(patch as Updateable<SiteScheduleTable>)
    .where("site_id", "=", siteId)
    .executeTakeFirst();
  return res.numUpdatedRows > 0n;
}

/** Same contract as the Airtable getWebsiteBySlug: slug is siteSlug(Name),
 *  precomputed into the UNIQUE sites.slug column at import time. */
export async function getSiteBySlug(db: Db, slug: string): Promise<WebsiteRow | null> {
  const r = await joined(db).where("sites.slug", "=", slug).executeTakeFirst();
  return r ? rowFromJoined(r as JoinedRow) : null;
}

/** By Airtable rec id (the PK) — approve-report's lookup shape. */
export async function getSiteById(db: Db, id: string): Promise<WebsiteRow | null> {
  const r = await joined(db).where("sites.id", "=", id).executeTakeFirst();
  return r ? rowFromJoined(r as JoinedRow) : null;
}

/** Same contract as the Airtable listWebsites: every site, one row each.
 *  Name-ordered for determinism (Airtable returned table order; no consumer
 *  is order-sensitive — the cockpit groups and sorts itself). */
export async function listSites(db: Db): Promise<WebsiteRow[]> {
  const rows = await joined(db).orderBy("sites.name").execute();
  return rows.map((r) => rowFromJoined(r as JoinedRow));
}

// ————————————————————————— reports —————————————————————————

/** stable checklist key → Airtable column name. The importer stores stable keys
 *  (mapReportRecord); `ReportRow.checklist` exposes Airtable column names — one
 *  derived map, built from the checklist definitions themselves. */
const CHECKLIST_FIELD_BY_KEY: ReadonlyMap<string, string> = new Map(
  [...MAINTENANCE_CHECKLIST, ...TESTING_CHECKLIST].map((i) => [i.key, i.field]),
);

function checklistFromStored(raw: string | null): Record<string, boolean> {
  let stored: Record<string, unknown> = {};
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        stored = parsed as Record<string, unknown>;
    } catch {
      // fall through to all-false — a bad blob must not throw the page
    }
  }
  const out: Record<string, boolean> = {};
  for (const [key, field] of CHECKLIST_FIELD_BY_KEY) out[field] = Boolean(stored[key]);
  return out;
}

function reportRowFromDb(r: Selectable<ReportsTable>): ReportRow {
  const p = r.lighthouse_performance;
  const a = r.lighthouse_accessibility;
  const b = r.lighthouse_best_practices;
  const seo = r.lighthouse_seo;
  const lighthouse =
    typeof p === "number" &&
    typeof a === "number" &&
    typeof b === "number" &&
    typeof seo === "number"
      ? { performance: p, accessibility: a, bestPractices: b, seo }
      : null;
  return {
    id: r.id,
    reportId: r.report_id ?? "",
    siteId: r.site_id ?? "",
    reportType: toReportType(r.report_type ?? undefined),
    period: r.period,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    completedOn: r.completed_on,
    lighthouse,
    gaUsersCurrent: r.ga_users_current,
    gaUsersPrevious: r.ga_users_previous,
    searchFoundPage1: bool(r.search_found_page1),
    searchPosition: r.search_position,
    lastTestedDate: r.last_tested_date,
    commentary: r.commentary,
    subjectOverride: r.subject_override,
    draftReady: r.draft_ready !== 0,
    approvedToSend: r.approved_to_send !== 0,
    sentAt: r.sent_at,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    deliveryStatus: (r.delivery_status ?? "pending") as DeliveryStatus,
    // The body lives IN the row (rendered_html) — the link points at the
    // dashboard's own preview route instead of an EXPIRING Airtable signed URL.
    // Strictly better for the operator: the old link 404'd once the URL aged out.
    renderedHtmlAttachment:
      r.rendered_html !== null
        ? { url: `/api/reports/${r.id}/preview`, filename: `${r.report_id ?? r.id}.html` }
        : null,
    resendMessageId: r.resend_message_id,
    checklist: checklistFromStored(r.checklist),
    autoEvidence: parseAutoEvidence(r.checklist_auto_evidence),
    sendOverride: r.send_override !== 0,
    overrideReason: r.override_reason,
    overrideBy: r.override_by,
    overrideAt: r.override_at,
  };
}

/** Same contract as the Airtable listAllReports. Newest-period-first (Airtable
 *  returned manual table order; every consumer filters/sorts itself). */
export async function listAllReports(db: Db): Promise<ReportRow[]> {
  const rows = await db
    .selectFrom("reports")
    .selectAll()
    .orderBy("period_start", "desc")
    .orderBy("id")
    .execute();
  return rows.map(reportRowFromDb);
}

/** Same contract as the Airtable listReportsForSite — served by idx_reports_site. */
export async function listReportsForSite(db: Db, siteId: string): Promise<ReportRow[]> {
  const rows = await db
    .selectFrom("reports")
    .selectAll()
    .where("site_id", "=", siteId)
    .orderBy("period_start", "desc")
    .orderBy("id")
    .execute();
  return rows.map(reportRowFromDb);
}

/** Columns a report writer mirrors after its Airtable write (same pattern as
 *  mirrorSiteField): the approve/override flow, the resend-webhook's delivery
 *  status, and — since #539 Phase 5 — the drafting path's queue flag and a
 *  re-run's refreshed scores.
 *
 *  `rendered_html` stays deliberately OUT even though the drafting path now
 *  writes it: bodies go through `storeRenderedHtml`, so a request handler
 *  holding a patch cannot accidentally write megabytes of HTML. `sent_at` and
 *  `resend_message_id` stay out because nothing but the send batch writes them
 *  and the hourly sync converges those. */
export type ReportMirrorPatch = Partial<
  Pick<
    ReportsTable,
    | "approved_to_send"
    | "approved_at"
    | "approved_by"
    | "send_override"
    | "override_reason"
    | "override_by"
    | "override_at"
    | "delivery_status"
    // Phase 4 report review: the console edits commentary and re-renders the
    // page immediately after the write, so the mirror has to carry it or the
    // operator sees their own save as a no-op until the next hourly sync.
    | "commentary"
    // Phase 5 drafting path. `draft_ready` is the queue flag `queueDraft`
    // writes — for the new draft AND for every row it supersedes, so without it
    // the console shows a site with two queued reports until the next sync.
    | "draft_ready"
    // A re-run (announce/launch reuse) refreshes an existing row's scores so the
    // eventually-sent email is not stale; the console reads the same numbers.
    | "lighthouse_performance"
    | "lighthouse_accessibility"
    | "lighthouse_best_practices"
    | "lighthouse_seo"
    | "ga_users_current"
    | "ga_users_previous"
    | "search_found_page1"
    | "search_position"
    | "completed_on"
  >
>;

/** Mirror an Airtable report write into Turso so the page re-render after an
 *  approve/override/bounce shows the new state immediately instead of after
 *  the next hourly sync. Callers treat a failure as non-fatal (the sync
 *  converges it); an empty patch is a no-op, never invalid SQL. */
export async function mirrorReportPatch(
  db: Db,
  reportId: string,
  patch: ReportMirrorPatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.updateTable("reports").set(patch).where("id", "=", reportId).execute();
}

/** Mirror a NEWLY CREATED Airtable Reports record into Turso (#539 Phase 5).
 *
 *  Every other report mirror is an UPDATE, which silently does nothing for a row
 *  that does not exist yet — so a draft created at 09:05 was invisible to the
 *  Turso-backed console until the 09:20 sync. Takes the raw record Airtable
 *  echoed back from the create, and maps it with the IMPORTER's own
 *  `mapReportRecord`: parity diffs Turso against exactly that function, so
 *  delegating is what makes the mirrored row parity-clean by construction rather
 *  than by a column list someone has to remember to extend.
 *
 *  Upsert, not insert, and the conflict branch drops `rendered_html` for the
 *  same reason the importer's does: the body is written later by a separate
 *  sharp-bearing step, so a re-mirror carrying null would blank a render that
 *  had already succeeded. */
export async function mirrorReportInsert(db: Db, rec: RawRecord): Promise<void> {
  const row = mapReportRecord(rec, null);
  const { rendered_html: _rh, ...rowSansHtml } = row;
  void _rh;
  await db
    .insertInto("reports")
    .values(row)
    .onConflict((oc) => oc.column("id").doUpdateSet(rowSansHtml))
    .execute();
}

/**
 * Store a freshly rendered report body, replacing whatever was there.
 *
 * Deliberately NOT part of `ReportMirrorPatch`: that patch is the request path's
 * write-through (approve, override, delivery status), and a rendered body is
 * produced by a batch job with sharp, never by a dashboard POST. Keeping it out
 * means a handler cannot accidentally write megabytes of HTML from a request.
 *
 * It REPLACES unconditionally. The importer's `when-missing` mode skips a report
 * that already has a body — correct for an import, wrong here: a refresh whose
 * entire purpose is showing the newest commentary must overwrite.
 */
export async function storeRenderedHtml(db: Db, reportId: string, html: string): Promise<void> {
  await db.updateTable("reports").set({ rendered_html: html }).where("id", "=", reportId).execute();
}

/** By rec id (the PK) — approve-report's read. */
export async function getReportById(db: Db, id: string): Promise<ReportRow | null> {
  const r = await db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst();
  return r ? reportRowFromDb(r) : null;
}

/** The preview route's read: the stored rendered body, or null when the report
 *  has none (imported while its signed URL was expired, or predates rendering). */
export async function getReportHtml(
  db: Db,
  id: string,
): Promise<{ html: string; reportId: string | null } | null> {
  const r = await db
    .selectFrom("reports")
    .select(["rendered_html", "report_id"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!r || r.rendered_html === null) return null;
  return { html: r.rendered_html, reportId: r.report_id };
}
