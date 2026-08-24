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
import type { Db } from "./client.js";
import type { Status, WebsiteRow } from "../reports/airtable/websites.js";
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
    status: str(r.status) as Status | null,
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
  };
}

/** The three-table join every read composes from. site_health/site_schedule
 *  rows are upserted alongside sites by the importer, but LEFT JOIN anyway —
 *  a site row must never vanish from a surface because a health row is absent. */
function joined(db: Db) {
  return db
    .selectFrom("sites")
    .leftJoin("site_health", "site_health.site_id", "sites.id")
    .leftJoin("site_schedule", "site_schedule.site_id", "sites.id")
    .selectAll(["sites", "site_health", "site_schedule"]);
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
