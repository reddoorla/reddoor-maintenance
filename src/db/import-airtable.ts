import type { Db } from "./client.js";
import type { SitesTable, SiteHealthTable, SiteScheduleTable, ReportsTable } from "./schema.js";
import { siteSlug } from "../reports/airtable/websites.js";
import { MAINTENANCE_CHECKLIST, TESTING_CHECKLIST } from "../reports/checklist.js";

/** One raw Airtable record: id + the fields object exactly as the API returns it
 *  (empty cells are ABSENT, not null — the API omits them). */
export type RawRecord = { id: string; fields: Record<string, unknown> };

/**
 * Phase 1.3 of #539: map raw Airtable records into the 0007 fleet-state tables,
 * and upsert them idempotently.
 *
 * The mapping here is the SINGLE source of truth for Airtable-column →
 * Turso-column: the parity harness (`db parity`) imports these same functions,
 * so "what the importer writes" and "what parity expects" cannot drift apart.
 *
 * Values are stored RAW (the cell as Airtable returns it, stringified where the
 * column is TEXT). Coercion — `toFrequency`, `toVerdict`, recipient splitting —
 * stays in the READ layer, exactly as `mapRow` does it today, so the store
 * never bakes in a lossy interpretation. The two exceptions are shapes, not
 * meanings: `Accepted Watch Conditions` normalizes to a JSON array (mapRow
 * accepts array or delimited string; the new store keeps one shape), and the
 * report checklist re-keys from Airtable column names to the stable keys in
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
  // Plaintext credentials — operator ruling 2026-08-23: these live on ONLY in
  // the frozen Airtable base. A new store does not inherit plaintext creds.
  "DNS username",
  "DNS password",
  "cms username",
  "cms password",
  // Link columns: Turso joins by rec id (D1); the links carry no extra data.
  "Reports",
  "Submissions",
  "Spam Screenouts",
  // Regenerated into sites.header_image as a BLOB by the header-image CLI (D5);
  // the Airtable attachment (an expiring signed URL) is never migrated.
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
 *  the site-details write-through (fleet-state.mirrorSiteField), so the editor
 *  and the importer share ONE Airtable-column → sites-column truth. */
export const SITE_FIELDS: Record<string, keyof SitesTable> = {
  Name: "name",
  url: "url",
  Status: "status",
  "point of contact": "point_of_contact",
  "maintenence freq": "maintenance_freq", // Airtable's misspelling dies at this boundary
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
  // `siteValueFor`, which BOTH this importer and that mirror go through.
  "Require Turnstile": "require_turnstile",
  "Accepted Watch Conditions": "accepted_watch_conditions",
};

/** Normalize an `Accepted Watch Conditions` cell (Airtable array, or a delimited
 *  string) to the trimmed list both stores agree on. */
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
 * Resolve one Airtable Websites cell to the value its `sites` column stores.
 *
 * The ONE shared path between `mapWebsiteRecord` (full-row import) and
 * `fleet-state.mirrorSiteField` (the editor's write-through) — same contract and
 * the same reason as `healthColumnFor`: a coercion that exists twice will
 * eventually disagree, and here a disagreement is not subtle. Parity compares
 * raw-to-raw, so a mirror storing `"true"` where the importer stores `1` reds
 * every hourly run until the next import quietly papers over it.
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
 *  lockstep tests, so the nightly writers and the importer share ONE
 *  Airtable-column → site_health-column truth. */
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

/** Boolean-checkbox health columns (Airtable true/absent → 1/0/null). */
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

/** Resolve one Airtable health field to its site_health column AND the exact
 *  coercion the importer applies to it. The ONE shared path between
 *  mapWebsiteRecord (full-row import) and fleet-state.mirrorHealthFields
 *  (partial write-through): a coercion that exists twice will eventually
 *  disagree, and the hourly import silently papers over the loser. Returns
 *  null for a field no health column claims. */
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
  // mirrors use, so import and write-through cannot drift apart.
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

/** Stable-key checklist mapping (Airtable column name → key). */
const CHECKLIST_BY_FIELD: ReadonlyArray<{ field: string; key: string }> = [
  ...MAINTENANCE_CHECKLIST,
  ...TESTING_CHECKLIST,
].map((i) => ({ field: i.field, key: i.key }));

/** Map one raw Reports record. `renderedHtml` is fetched by the caller (the
 *  attachment URL is an expiring signed URL — see the design's Attachments
 *  section); pass null when the record has no attachment or the fetch failed. */
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
    // The Airtable cell is a long-text field, so the API hands us a STRING of
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

/** First Rendered HTML attachment's signed URL, or null. Exposed so the CLI can
 *  fetch it and tests can assert which URL would be fetched. */
export function renderedHtmlUrl(rec: RawRecord): string | null {
  const atts = rec.fields["Rendered HTML"] as Array<{ url?: string }> | undefined;
  const url = atts?.[0]?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** What the import removed because Airtable no longer has the record — and what
 *  it declined to remove. `refusals` is non-empty only when the incoming read
 *  looked untrustworthy; in that case NOTHING was deleted for that table. */
export type ReapSummary = {
  sites: string[];
  reports: string[];
  refusals: string[];
};

/** Reaping is the only destructive thing the importer does, and it acts on the
 *  absence of evidence — so it is only ever as trustworthy as the read that
 *  motivated it. A short read (a truncated page, a partial outage) is
 *  indistinguishable from mass deletion by looking at the rows alone, so the
 *  allowance is deliberately shaped like an operator tidying up rather than
 *  like a bad page: at most 10% of what is stored, with a floor of 5 so a small
 *  table stays workable. Over that, refuse the whole table and let parity red
 *  the run — a wedged-red sync is recoverable, an emptied Turso is not. */
const REAP_FLOOR = 5;
const REAP_FRACTION = 0.1;

export function reapAllowance(stored: number): number {
  return Math.max(REAP_FLOOR, Math.ceil(stored * REAP_FRACTION));
}

/** Human lines plus the FLEET_REAP machine line, emitted on EVERY pass (nothing
 *  reaped included) — an absent line must read as "the reap never ran", never as
 *  "it ran clean", the same contract FLEET_PARITY and FLEET_SYNC hold. Shared by
 *  `db sync` and the one-shot `db import-airtable`: both can delete, so a second
 *  hand-rolled copy is how one of them ends up doing it quietly. */
export function formatReapSummary(reaped: ReapSummary): string[] {
  const lines: string[] = [];
  for (const id of reaped.sites) {
    lines.push(`✂ reaped sites ${id} (+ its health/schedule rows) — no longer in Airtable`);
  }
  for (const id of reaped.reports) {
    lines.push(`✂ reaped reports ${id} — no longer in Airtable`);
  }
  for (const reason of reaped.refusals) lines.push(`⚠ ${reason}`);
  lines.push(
    `FLEET_REAP sites=${reaped.sites.length} reports=${reaped.reports.length} ` +
      `refused=${reaped.refusals.length}`,
  );
  return lines;
}

/** Null when the reap may proceed, else the human reason it was refused. */
export function reapRefusal(
  table: string,
  incoming: number,
  stored: number,
  toReap: number,
): string | null {
  if (incoming === 0 && stored > 0) {
    return `${table}: REFUSED to reap — Airtable returned 0 rows while ${stored} are stored; that is a failed read, not an empty fleet. Nothing deleted.`;
  }
  const allowed = reapAllowance(stored);
  if (toReap > allowed) {
    return `${table}: REFUSED to reap — ${toReap} rows are missing from Airtable, over the ${allowed}-row allowance for ${stored} stored. Nothing deleted; re-run, and if the deletions are real, remove them in smaller batches.`;
  }
  return null;
}

export type ImportSummary = {
  sites: number;
  reports: number;
  /** Rows removed (or refused) because their Airtable record is gone. */
  reaped: ReapSummary;
  /** Reports whose Rendered HTML attachment could not be fetched (URL expired /
   *  network) — imported with rendered_html null, named so the run is honest. */
  renderedHtmlMisses: string[];
  /** Attachment fetches attempted and succeeded this run. */
  renderedHtmlFetched: number;
  /** Fetches skipped because the stored row already carries rendered_html
   *  (only in reportHtml: "when-missing" mode — the hourly sync's mode). */
  renderedHtmlSkipped: number;
};

export type ImportOptions = {
  /** "always" (default): fetch every report's Rendered HTML attachment — the
   *  one-shot full import's mode. "when-missing": fetch only for reports whose
   *  stored row has no rendered_html yet — the hourly sync's mode, so 24 runs a
   *  day don't re-download every attachment every hour. Safe for Phase 2:
   *  nothing reads reports.rendered_html from Turso until the Phase 4 report
   *  review lands; revisit the staleness story there (a re-rendered report's
   *  stored HTML goes stale under "when-missing"). Parity is unaffected —
   *  rendered_html is a parity SKIP_COLUMN. */
  reportHtml?: "always" | "when-missing";
};

export type ImportIo = {
  listWebsiteRecords: () => Promise<RawRecord[]>;
  listReportRecords: () => Promise<RawRecord[]>;
  /** Fetch an attachment body; null on failure (the miss is reported, not fatal). */
  fetchAttachment: (url: string) => Promise<string | null>;
  now: () => Date;
};

/**
 * Import both tables, idempotently: upsert by rec id, so a re-run converges
 * instead of duplicating. On conflict the sites upsert deliberately does NOT
 * touch the header_image* columns — Airtable stopped being their source (D5),
 * so a re-import must never wipe a regenerated image. rendered_html is only
 * overwritten when the fetch succeeded, for the same reason: a re-run with an
 * expired signed URL must not erase a body captured while it was valid.
 */
export async function importFleetState(
  db: Db,
  io: ImportIo,
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const computedAt = io.now().toISOString();
  const websites = await io.listWebsiteRecords();

  const mapped = websites.map((r) => mapWebsiteRecord(r, computedAt));
  const slugOwner = new Map<string, string>();
  for (const m of mapped) {
    const prior = slugOwner.get(m.site.slug);
    if (prior)
      throw new Error(`slug collision: ${prior} and ${m.site.id} both map to '${m.site.slug}'`);
    slugOwner.set(m.site.slug, m.site.id);
  }

  for (const { site, health, schedule } of mapped) {
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

  const reports = await io.listReportRecords();
  // "when-missing": one pre-read of which report rows already hold a body, so
  // the loop can skip their attachment fetches. A skipped fetch keeps the
  // stored body (the upsert falls into the rowSansHtml branch) and is counted,
  // not treated as a miss.
  const alreadyStored =
    opts.reportHtml === "when-missing"
      ? new Set(
          (
            await db
              .selectFrom("reports")
              .select("id")
              .where("rendered_html", "is not", null)
              .execute()
          ).map((r) => r.id),
        )
      : null;
  const misses: string[] = [];
  let fetched = 0;
  let skipped = 0;
  for (const rec of reports) {
    const url = renderedHtmlUrl(rec);
    const skip = url !== null && alreadyStored !== null && alreadyStored.has(rec.id);
    if (skip) skipped++;
    const html = url && !skip ? await io.fetchAttachment(url) : null;
    if (url && !skip && html === null) misses.push(rec.id);
    if (html !== null) fetched++;
    const row = mapReportRecord(rec, html);
    const { rendered_html: _rh, ...rowSansHtml } = row;
    void _rh;
    await db
      .insertInto("reports")
      .values(row)
      .onConflict((oc) => oc.column("id").doUpdateSet(html !== null ? row : rowSansHtml))
      .execute();
  }

  const reaped: ReapSummary = { sites: [], reports: [], refusals: [] };

  // Sites first. No foreign keys are declared, so the health and schedule rows
  // must be removed explicitly — parity only reverse-checks `sites`, so an
  // orphan left here would linger forever, unnoticed and still readable.
  const liveSiteIds = new Set(mapped.map((m) => m.site.id));
  const storedSites = (await db.selectFrom("sites").select("id").execute()).map((r) =>
    String(r.id),
  );
  const staleSites = storedSites.filter((id) => !liveSiteIds.has(id)).sort();
  const siteRefusal = reapRefusal("sites", websites.length, storedSites.length, staleSites.length);
  if (siteRefusal) reaped.refusals.push(siteRefusal);
  else if (staleSites.length > 0) {
    await db.deleteFrom("site_health").where("site_id", "in", staleSites).execute();
    await db.deleteFrom("site_schedule").where("site_id", "in", staleSites).execute();
    await db.deleteFrom("sites").where("id", "in", staleSites).execute();
    reaped.sites = staleSites;
  }

  const liveReportIds = new Set(reports.map((r) => r.id));
  const storedReports = (await db.selectFrom("reports").select("id").execute()).map((r) =>
    String(r.id),
  );
  const staleReports = storedReports.filter((id) => !liveReportIds.has(id)).sort();
  const reportRefusal = reapRefusal(
    "reports",
    reports.length,
    storedReports.length,
    staleReports.length,
  );
  if (reportRefusal) reaped.refusals.push(reportRefusal);
  else if (staleReports.length > 0) {
    await db.deleteFrom("reports").where("id", "in", staleReports).execute();
    reaped.reports = staleReports;
  }

  return {
    sites: mapped.length,
    reports: reports.length,
    renderedHtmlMisses: misses,
    renderedHtmlFetched: fetched,
    renderedHtmlSkipped: skipped,
    reaped,
  };
}
