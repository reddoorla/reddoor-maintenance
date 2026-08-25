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
 *  being its source — the bytes belong in `sites.header_image*`. Nothing
 *  writes those columns yet (verified empty across all 44 prod rows,
 *  2026-08-24), so this reads null fleet-wide today, and approve-report — the
 *  only request-path consumer — stays on the Airtable reader until the
 *  header-image writer moves in Phase 3. The `url` is "" because the bytes
 *  live in the row itself, not behind a signed URL.
 */
import type { Selectable, Updateable } from "kysely";
import type { Db } from "./client.js";
import type { ReportsTable, SiteHealthTable, SiteScheduleTable } from "./schema.js";
import { SITE_FIELDS, healthColumnFor, scheduleColumnFor } from "./import-airtable.js";
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
 *  Deliberately NOT applicable to `Require Turnstile` or other non-text
 *  columns: every editor field is plain text today, and the lockstep test
 *  pins that assumption. */
export async function mirrorSiteField(
  db: Db,
  siteId: string,
  airtableColumn: string,
  value: string,
): Promise<void> {
  const col = SITE_FIELDS[airtableColumn];
  if (!col)
    throw new Error(`mirrorSiteField: importer claims no sites column for '${airtableColumn}'`);
  const stored = value.trim() === "" ? null : value;
  await db
    .updateTable("sites")
    .set({ [col]: stored })
    .where("id", "=", siteId)
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

/** Columns the REQUEST-PATH report writers mirror after their Airtable write
 *  (same pattern as mirrorSiteField): the approve/override flow and the
 *  resend-webhook's delivery status. Send-path columns (sent_at,
 *  resend_message_id, rendered_html) are deliberately absent — the send is a
 *  CLI batch whose writes reach Turso via the hourly sync until Phase 3. */
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
