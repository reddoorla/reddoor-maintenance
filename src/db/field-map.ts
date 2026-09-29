import type { SitesTable, SiteHealthTable, SiteScheduleTable, ReportsTable } from "./schema.js";
import { siteSlug } from "../fleet/site-row.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../reports/checklist.js";

/** One raw record: id + a column-named fields object (empty cells are ABSENT,
 *  not null). */
export type RawRecord = { id: string; fields: Record<string, unknown> };

/**
 * Map column-named records into the 0007 fleet-state tables. The fleet-state
 * mirrors take column-named FieldSets, and this is the SINGLE source of truth
 * for column name → Turso column.
 *
 * Values are stored RAW (the cell as given, stringified where the
 * column is TEXT). Coercion — `toFrequency`, `toVerdict`, recipient splitting —
 * stays in the READ layer, exactly as `mapRow` does it today, so the store
 * never bakes in a lossy interpretation. The two exceptions are shapes, not
 * meanings: `Accepted Watch Conditions` normalizes to a JSON array (mapRow
 * accepts array or delimited string; the new store keeps one shape), and the
 * report checklist re-keys from column names to the stable keys in
 * src/reports/checklist.ts.
 */

/** Websites columns that must NEVER reach Turso, and why. Everything else that
 *  is populated but unmapped lands in `sites.legacy` (JSON, keyed by original
 *  column name) so no data is silently dropped. */
export const EXCLUDED_WEBSITE_FIELDS: ReadonlySet<string> = new Set([
  // Dropped under D4's rule (empty everywhere + unreferenced), verified 2026-08-23.
  "site host username",
  "site host password",
  "launch day",
  "contract link",
  // Plaintext credentials — operator ruling 2026-08-23: never stored.
  "DNS username",
  "DNS password",
  "cms username",
  "cms password",
  // Link columns: Turso joins by rec id (D1); the links carry no extra data.
  "Reports",
  "Submissions",
  "Spam Screenouts",
  // Regenerated into sites.header_image as a BLOB by the header-image CLI (D5);
  // the attachment cell itself is never mapped.
  "Header image",
]);

const s = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  return String(v);
};
const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
const b01 = (v: unknown): number => (v === true ? 1 : 0);
const b01n = (v: unknown): number | null => (typeof v === "boolean" ? (v ? 1 : 0) : null);
const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/** Direct field→column map for `sites` (operator-owned config). Exported for
 *  the site-details write (fleet-state.mirrorSiteField), so the editor and
 *  `mapWebsiteRecord` share ONE column-name → sites-column truth. */
export const SITE_FIELDS: Record<string, keyof SitesTable> = {
  Name: "name",
  url: "url",
  Status: "status",
  "point of contact": "point_of_contact",
  "maintenence freq": "maintenance_freq", // legacy column name's misspelling dies here
  "testing freq": "testing_freq",
  "maintenance day": "maintenance_day",
  "testing day": "testing_day",
  "GA4 property ID": "ga4_property_id",
  "Search query": "search_query",
  "Search Console property": "search_console_property",
  "Git repo": "git_repo",
  "Netlify ID": "netlify_id",
  "Report recipients (To)": "report_recipients_to",
  "Report recipients (CC)": "report_recipients_cc",
  "Copy — Intro": "copy_intro",
  "Copy — Contact": "copy_contact",
  "Copy — Footer": "copy_footer",
  "Newsletter Webhook": "newsletter_webhook",
  "Mailchimp API Key": "mailchimp_api_key",
  "Mailchimp Audience ID": "mailchimp_audience_id",
  "Notify Routing": "notify_routing",
  "Prismic Ack Until": "prismic_ack_until",
  "Launched at": "launched_at",
  // Non-text columns. They live here so `mirrorSiteField` can resolve them like
  // any other editor field; the coercion that makes them non-text is in
  // `siteValueFor`, which BOTH `mapWebsiteRecord` and that mirror go through.
  "Require Turnstile": "require_turnstile",
  "Accepted Watch Conditions": "accepted_watch_conditions",
};

/** Normalize an `Accepted Watch Conditions` cell (an array, or a delimited
 *  string) to the trimmed list. */
function normalizeAwc(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Resolve one Websites cell to the value its `sites` column stores.
 *
 * The ONE shared path between `mapWebsiteRecord` (full row) and
 * `fleet-state.mirrorSiteField` (the editor's write) — same contract and
 * the same reason as `healthColumnFor`: a coercion that exists twice will
 * eventually disagree.
 */
export function siteValueFor(column: keyof SitesTable, raw: unknown): string | number | null {
  if (column === "require_turnstile") return b01(raw);
  if (column === "accepted_watch_conditions") {
    const awc = normalizeAwc(raw);
    return awc.length > 0 ? JSON.stringify(awc) : null;
  }
  return s(raw);
}

/** Direct field→column map for `site_health` (nightly-cron-owned). Exported for
 *  the Phase 3 writer mirrors (fleet-state.mirrorHealthFields) and their
 *  lockstep tests, so the nightly writers and `mapWebsiteRecord` share ONE
 *  column-name → site_health-column truth. */
export const HEALTH_FIELDS: Record<string, keyof SiteHealthTable> = {
  pScore: "p_score",
  rScore: "r_score",
  bpScore: "bp_score",
  seoScore: "seo_score",
  "Last lighthouse audit at": "lighthouse_at",
  "A11y Violations": "a11y_violations",
  "Deps Drifted": "deps_drifted",
  "Deps Major Behind": "deps_major_behind",
  "Deps Outdated": "deps_outdated",
  "Deps Major Outdated": "deps_major_outdated",
  "Security Vulns Critical": "vulns_critical",
  "Security Vulns High": "vulns_high",
  "Security Vulns Moderate": "vulns_moderate",
  "Security Vulns Low": "vulns_low",
  "Last security audit at": "security_audit_at",
  "Security advisories": "security_advisories",
  "Security Auto-Fix Attempts": "auto_fix_attempts",
  "Analytics soft-fail at": "analytics_soft_fail_at",
  "Cert days remaining": "cert_days_remaining",
  "Domain checked at": "domain_checked_at",
  "Deploy status": "deploy_status",
  "Last deploy at": "last_deploy_at",
  "Deploy log URL": "deploy_log_url",
  "Deploy checked at": "deploy_checked_at",
  "Function health": "function_health",
  "CMS Reachable": "cms_reachable",
  "Turnstile widget": "turnstile_widget",
  "Function health checked at": "function_health_checked_at",
  "Broken links": "broken_links",
  "Browser checked at": "browser_checked_at",
  "Uptime Reachable": "uptime_reachable",
  "Titles & Meta OK": "titles_meta_ok",
  "Smoke OK": "smoke_ok",
  "Last Smoke At": "last_smoke_at",
  "Form E2E OK": "form_e2e_ok",
  "Form E2E checked at": "form_e2e_checked_at",
  "Renovate Failing CIs": "renovate_failing_cis",
  "Default Branch CI": "default_branch_ci",
  "Last Commit At": "last_commit_at",
  "GitHub Signals At": "github_signals_at",
  "Prismic Models": "prismic_models",
  "Prismic Models Checked At": "prismic_models_checked_at",
  "Prismic Models Drift": "prismic_models_drift",
};

/** Numeric health columns (everything else in HEALTH_FIELDS stores as text). */
const HEALTH_NUMERIC: ReadonlySet<keyof SiteHealthTable> = new Set([
  "p_score",
  "r_score",
  "bp_score",
  "seo_score",
  "a11y_violations",
  "deps_drifted",
  "deps_major_behind",
  "deps_outdated",
  "deps_major_outdated",
  "vulns_critical",
  "vulns_high",
  "vulns_moderate",
  "vulns_low",
  "auto_fix_attempts",
  "cert_days_remaining",
  "broken_links",
  "renovate_failing_cis",
]);

/** Boolean-checkbox health columns (true/absent → 1/0/null). */
export const HEALTH_BOOLEAN: Record<string, keyof SiteHealthTable> = {
  "Crossbrowser OK": "crossbrowser_ok",
  "Mobile OK": "mobile_ok",
  "Links OK": "links_ok",
};

/** Fields consumed by the schedule table. */
export const SCHEDULE_FIELDS: Record<string, keyof SiteScheduleTable> = {
  "Next maintenance at": "next_maintenance_at",
  "Next testing at": "next_testing_at",
};

/** Resolve one health field to its site_health column AND the exact
 *  coercion `mapWebsiteRecord` applies to it. The ONE shared path between
 *  mapWebsiteRecord (full row) and fleet-state.mirrorHealthFields
 *  (partial write): a coercion that exists twice will eventually
 *  disagree. Returns null for a field no health column claims. */
export function healthColumnFor(
  field: string,
): { col: keyof SiteHealthTable; coerce: (v: unknown) => string | number | null } | null {
  const direct = HEALTH_FIELDS[field];
  if (direct) return { col: direct, coerce: HEALTH_NUMERIC.has(direct) ? n : s };
  const bool = HEALTH_BOOLEAN[field];
  if (bool) return { col: bool, coerce: b01n };
  return null;
}

/** The schedule twin of {@link healthColumnFor} (both columns store as text). */
export function scheduleColumnFor(
  field: string,
): { col: keyof SiteScheduleTable; coerce: (v: unknown) => string | null } | null {
  const col = SCHEDULE_FIELDS[field];
  return col ? { col, coerce: s } : null;
}

export type MappedWebsite = {
  site: Omit<
    SitesTable,
    "header_image" | "header_image_filename" | "header_image_type" | "header_image_generated_at"
  >;
  health: SiteHealthTable;
  schedule: SiteScheduleTable;
};

/** Map one raw Websites record into its three-table shape. Pure. */
export function mapWebsiteRecord(rec: RawRecord, computedAt: string): MappedWebsite {
  const f = rec.fields;
  const name = s(f["Name"]);
  if (!name) throw new Error(`Websites ${rec.id}: blank Name — cannot derive a slug`);
  const slug = siteSlug(name);
  if (!slug) throw new Error(`Websites ${rec.id}: Name "${name}" yields an empty slug`);

  const site: MappedWebsite["site"] = {
    id: rec.id,
    slug,
    name,
    url: null,
    status: null,
    point_of_contact: null,
    maintenance_freq: null,
    testing_freq: null,
    maintenance_day: null,
    testing_day: null,
    ga4_property_id: null,
    search_query: null,
    search_console_property: null,
    git_repo: null,
    netlify_id: null,
    report_recipients_to: null,
    report_recipients_cc: null,
    copy_intro: null,
    copy_contact: null,
    copy_footer: null,
    newsletter_webhook: null,
    mailchimp_api_key: null,
    mailchimp_audience_id: null,
    notify_routing: null,
    require_turnstile: 0,
    accepted_watch_conditions: null,
    prismic_ack_until: null,
    launched_at: null,
    legacy: null,
  };
  // Every mapped column goes through siteValueFor, so the non-text ones
  // (require_turnstile, accepted_watch_conditions) get the SAME coercion the
  // editor's write-through mirror applies. The literals above are placeholders
  // this loop overwrites; they exist only to satisfy the row type.
  for (const [field, col] of Object.entries(SITE_FIELDS)) {
    if (col === "name") continue; // handled above (validated)
    (site as unknown as Record<string, unknown>)[col] = siteValueFor(col, f[field]);
  }

  const health = { site_id: rec.id } as SiteHealthTable;
  // Through healthColumnFor — the SAME resolution+coercion the Phase 3 writer
  // mirrors use, so the full-row map and the partial writes cannot drift apart.
  for (const field of [...Object.keys(HEALTH_FIELDS), ...Object.keys(HEALTH_BOOLEAN)]) {
    const m = healthColumnFor(field);
    if (m) (health as unknown as Record<string, unknown>)[m.col] = m.coerce(f[field]);
  }

  const schedule: SiteScheduleTable = {
    site_id: rec.id,
    next_maintenance_at: s(f["Next maintenance at"]),
    next_testing_at: s(f["Next testing at"]),
    computed_at: computedAt,
  };

  // Everything populated that no table claims and no exclusion bans → legacy.
  const claimed = new Set<string>([
    "Name",
    ...Object.keys(SITE_FIELDS),
    ...Object.keys(HEALTH_FIELDS),
    ...Object.keys(HEALTH_BOOLEAN),
    ...Object.keys(SCHEDULE_FIELDS),
  ]);
  const legacy: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(f)) {
    if (claimed.has(field) || EXCLUDED_WEBSITE_FIELDS.has(field)) continue;
    legacy[field] = value;
  }
  site.legacy = Object.keys(legacy).length > 0 ? JSON.stringify(legacy) : null;

  return { site, health, schedule };
}

/** Stable-key checklist mapping (column name → key). */
const CHECKLIST_BY_FIELD: ReadonlyArray<{ field: string; key: string }> = [
  ...MAINTENANCE_CHECKLIST,
  ...TESTING_CHECKLIST,
].map((i) => ({ field: i.field, key: i.key }));

/** Map one raw Reports record. `renderedHtml` is supplied by the caller; pass
 *  null when there is no body. */
export function mapReportRecord(rec: RawRecord, renderedHtml: string | null): ReportsTable {
  const f = rec.fields;
  const linkSites = (f["Site"] as string[] | undefined) ?? [];
  const checklist: Record<string, boolean> = {};
  for (const { field, key } of CHECKLIST_BY_FIELD) checklist[key] = Boolean(f[field]);

  return {
    id: rec.id,
    site_id: linkSites[0] ?? null,
    report_id: s(f["Report ID"]),
    report_type: s(f["Report type"]),
    period: s(f["Period"]),
    period_start: s(f["Period start"]),
    period_end: s(f["Period end"]),
    completed_on: s(f["Completed on"]),
    lighthouse_performance: n(f["Lighthouse — Performance"]),
    lighthouse_accessibility: n(f["Lighthouse — Accessibility"]),
    lighthouse_best_practices: n(f["Lighthouse — Best Practices"]),
    lighthouse_seo: n(f["Lighthouse — SEO"]),
    ga_users_current: n(f["GA users (period)"]),
    ga_users_previous: n(f["GA users (prev period)"]),
    search_found_page1: b01n(f["Search found page 1"]),
    search_position: n(f["Search position"]),
    last_tested_date: s(f["Last tested date"]),
    commentary: s(f["Commentary"]),
    subject_override: s(f["Subject override"]),
    draft_ready: b01(f["Draft ready"]),
    approved_to_send: b01(f["Approved to send"]),
    approved_at: s(f["Approved At"]),
    approved_by: s(f["Approved By"]),
    send_override: b01(f["Send override"]),
    override_reason: s(f["Override reason"]),
    override_by: s(f["Override by"]),
    override_at: s(f["Override at"]),
    sent_at: s(f["Sent at"]),
    delivery_status: s(f["Delivery status"]) ?? "pending",
    resend_message_id: s(f["Resend message ID"]),
    checklist: JSON.stringify(checklist),
    // The cell is a long-text field, so it arrives as a STRING of
    // JSON — store it verbatim. json() here would double-encode it, and
    // parseAutoEvidence on the read side would then parse to a string and
    // yield null (evidence silently lost). The non-string branch only exists
    // for defensive completeness.
    checklist_auto_evidence:
      typeof f["Checklist auto-evidence"] === "string"
        ? s(f["Checklist auto-evidence"])
        : json(f["Checklist auto-evidence"] ?? undefined),
    rendered_html: renderedHtml,
  };
}
